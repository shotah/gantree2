import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, jsonResult, textResult } from "@/harness/core/tools";
import {
  ArgTypeError,
  errorText,
  getBoolOnly,
  getInt,
  getString,
  getStringSlice,
  hasKey,
  isRecord,
  needArg,
  requireArgString,
  requireString,
  strField,
  toolHint,
} from "@/harness/plugins/google/args";
import { toolDef } from "@/harness/plugins/google/catalog";
import type { GoogleClient } from "@/harness/plugins/google/http";
import { onlyIds } from "@/harness/plugins/google/plural";
import { isResult, openUser } from "@/harness/plugins/google/session";

const PEOPLE = "https://people.googleapis.com/v1";
const BASIC = "names,emailAddresses,phoneNumbers,organizations";
const DETAILED = "names,emailAddresses,phoneNumbers,organizations,biographies,addresses,birthdays,urls,photos,metadata,memberships";
const GROUP_FIELDS = "name,groupType,memberCount,metadata";

const warmed = new Set<string>();

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function contactsTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("contacts_list", (args, call) => listContacts(ctx, args, call)),
    bind("contacts_get", (args, call) => getContact(ctx, args, call)),
    bind("contacts_search", (args, call) => searchContacts(ctx, args, call)),
    bind("contacts_list_groups", (args, call) => listGroups(ctx, args, call)),
    bind("contacts_get_group", (args, call) => getGroup(ctx, args, call)),
    bind("contacts_create", (args, call) => createContact(ctx, args, call)),
    bind("contacts_update", (args, call) => updateContact(ctx, args, call)),
    bind("contacts_delete", (args, call) => deleteContact(ctx, args, call)),
    bind("contacts_batch_create", (args, call) => batchCreate(ctx, args, call)),
    bind("contacts_batch_update", (args, call) => batchUpdate(ctx, args, call)),
    bind("contacts_batch_delete", (args, call) => batchDelete(ctx, args, call)),
    bind("contacts_create_group", (args, call) => createGroup(ctx, args, call)),
    bind("contacts_update_group", (args, call) => updateGroup(ctx, args, call)),
    bind("contacts_delete_group", (args, call) => deleteGroup(ctx, args, call)),
    bind("contacts_update_group_members", (args, call) => modifyMembers(ctx, args, call)),
  ];
}

function personName(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("people/") ? trimmed : `people/${trimmed}`;
}

function groupName(id: string): string {
  return id.startsWith("contactGroups/") ? id : `contactGroups/${id}`;
}

function cap(n: number, max: number): number {
  return Math.min(n, max);
}

async function listContacts(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "contacts_list()"));
  if (isResult(opened)) {
    return opened;
  }
  const query: Record<string, string | number> = {
    personFields: BASIC,
    pageSize: cap(getInt(args, "page_size", 100), 1000),
  };
  const pageToken = getString(args, "page_token", "");
  const sortOrder = getString(args, "sort_order", "");
  if (pageToken !== "") {
    query.pageToken = pageToken;
  }
  if (sortOrder !== "") {
    query.sortOrder = sortOrder;
  }
  let result: unknown;
  try {
    result = await opened.api.get(`${PEOPLE}/people/me/connections`, query);
  } catch (e) {
    return errorResult(`listing contacts: ${errorText(e)}`);
  }
  const only = onlyIds(args);
  let connections = arr(result, "connections");
  if (only) {
    connections = connections.filter((person) => {
      const resource = strField(person, "resourceName");
      const id = resource.startsWith("people/") ? resource.slice("people/".length) : resource;
      return only.has(id) || only.has(resource);
    });
    return jsonResult(connections.map((person) => ({
      id: strField(person, "resourceName").replace(/^people\//u, ""),
      name: strField(arr(person, "names")[0], "displayName"),
    })));
  }
  if (connections.length === 0) {
    return textResult(`No contacts found for ${opened.email}.`);
  }
  const totalField = isRecord(result) && typeof result.totalPeople === "number" ? result.totalPeople : 0;
  const total = totalField === 0 ? connections.length : totalField;
  let text = `Contacts for ${opened.email} (${connections.length} of ${total}):\n\n`;
  for (const person of connections) {
    text += `${formatContact(person, false)}\n\n`;
  }
  const next = strField(result, "nextPageToken");
  if (next !== "") {
    text += `Next page token: ${next}`;
  }
  return textResult(text);
}

async function getContact(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "contacts_get(contact_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const raw = requireString(args, "contact_id");
  if (raw === undefined || raw.trim() === "") {
    return needArg("contact_id", "contacts_search(query=\"…\") then contacts_get(contact_id=\"people/…\")");
  }
  const contactID = raw.trim();
  let person: unknown;
  try {
    person = await opened.api.get(`${PEOPLE}/${personName(contactID)}`, { personFields: DETAILED });
  } catch (e) {
    return toolHint(`getting contact ${contactID}: ${errorText(e)}`, "contacts_search(query=\"…\") then contacts_get(contact_id=\"people/…\")");
  }
  return textResult(`Contact Details for ${opened.email}:\n\n${formatContact(person, true)}`);
}

async function searchContacts(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "contacts_search(query=\"…\")"));
  if (isResult(opened)) {
    return opened;
  }
  const raw = requireString(args, "query");
  if (raw === undefined || raw.trim() === "") {
    return needArg("query", "contacts_search(query=\"Jane Doe\")");
  }
  const query = raw.trim();
  try {
    await warmup(opened.api, opened.email);
    const result = await opened.api.get(`${PEOPLE}/people:searchContacts`, {
      query,
      readMask: BASIC,
      pageSize: cap(getInt(args, "page_size", 30), 30),
    });
    const results = arr(result, "results");
    if (results.length === 0) {
      return textResult(`No contacts found matching '${query}' for ${opened.email}.`);
    }
    let text = `Search Results for '${query}' (${results.length} found):\n\n`;
    for (const item of results) {
      text += `${formatContact(isRecord(item) ? item.person : undefined, false)}\n\n`;
    }
    return textResult(text);
  } catch (e) {
    return errorResult(`searching contacts: ${errorText(e)}`);
  }
}

async function warmup(api: GoogleClient, email: string): Promise<void> {
  if (warmed.has(email)) {
    return;
  }
  try {
    await api.get(`${PEOPLE}/people:searchContacts?query=`, { readMask: "names", pageSize: 1 });
  } catch {
    // Warmup failure is non-fatal, matching the Go server.
  }
  warmed.add(email);
}

async function createContact(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "contacts_create(given_name, email=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const person = buildPerson(args);
  if (!person) {
    return toolHint("at least one field required (given_name, family_name, email, or phone)", "contacts_create(given_name, email=…)");
  }
  let result: unknown;
  try {
    result = await opened.api.post(`${PEOPLE}/people:createContact`, person, { personFields: DETAILED });
  } catch (e) {
    return errorResult(`creating contact: ${errorText(e)}`);
  }
  return textResult(`Contact Created for ${opened.email}:\n\n${formatContact(result, true)}`);
}

function formatContact(person: unknown, detailed: boolean): string {
  if (!isRecord(person)) {
    return "";
  }
  const resource = strField(person, "resourceName");
  const contactID = resource.startsWith("people/") ? resource.slice("people/".length) : resource;
  const lines = [`Contact ID: ${contactID === "" ? "Unknown" : contactID}`];
  const names = arr(person, "names");
  const display = strField(names[0], "displayName");
  if (display !== "") {
    lines.push(`Name: ${display}`);
  }
  const emails = arr(person, "emailAddresses").map((row) => strField(row, "value")).filter((v) => v !== "");
  if (emails.length > 0) {
    lines.push(`Email: ${emails.join(", ")}`);
  }
  const phones = arr(person, "phoneNumbers").map((row) => strField(row, "value")).filter((v) => v !== "");
  if (phones.length > 0) {
    lines.push(`Phone: ${phones.join(", ")}`);
  }
  const org = arr(person, "organizations")[0];
  const orgParts: string[] = [];
  if (strField(org, "title") !== "") {
    orgParts.push(strField(org, "title"));
  }
  if (strField(org, "name") !== "") {
    orgParts.push(`at ${strField(org, "name")}`);
  }
  if (orgParts.length > 0) {
    lines.push(`Organization: ${orgParts.join(" ")}`);
  }
  if (detailed) {
    lines.push(...detailedLines(person));
  }
  return lines.join("\n");
}

function detailedLines(person: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const address = strField(arr(person, "addresses")[0], "formattedValue");
  if (address !== "") {
    lines.push(`Address: ${address}`);
  }
  const date = arr(person, "birthdays")[0];
  const birthday = isRecord(date) ? date.date : undefined;
  if (isRecord(birthday)) {
    const month = typeof birthday.month === "number" ? birthday.month : 0;
    const day = typeof birthday.day === "number" ? birthday.day : 0;
    const year = typeof birthday.year === "number" ? birthday.year : 0;
    lines.push(`Birthday: ${year > 0 ? `${year}/${month}/${day}` : `${month}/${day}`}`);
  }
  const urls = arr(person, "urls").map((row) => strField(row, "value")).filter((v) => v !== "");
  if (urls.length > 0) {
    lines.push(`URLs: ${urls.join(", ")}`);
  }
  let bio = strField(arr(person, "biographies")[0], "value");
  if (bio.length > 200) {
    bio = `${bio.slice(0, 200)}...`;
  }
  if (bio !== "") {
    lines.push(`Notes: ${bio}`);
  }
  const meta = person.metadata;
  const sources = isRecord(meta) ? arr(meta, "sources").map((row) => strField(row, "type")).filter((v) => v !== "") : [];
  if (sources.length > 0) {
    lines.push(`Sources: ${sources.join(", ")}`);
  }
  return lines;
}

function buildPerson(args: Record<string, unknown>): Record<string, unknown> | undefined {
  const given = typeof args.given_name === "string" ? args.given_name : "";
  const family = typeof args.family_name === "string" ? args.family_name : "";
  const email = typeof args.email === "string" ? args.email : "";
  const phone = typeof args.phone === "string" ? args.phone : "";
  const organization = typeof args.organization === "string" ? args.organization : "";
  const job = typeof args.job_title === "string" ? args.job_title : "";
  const notes = typeof args.notes === "string" ? args.notes : "";
  const person: Record<string, unknown> = {};
  let has = false;
  if (given !== "" || family !== "") {
    person.names = [{ givenName: given, familyName: family }];
    has = true;
  }
  if (email !== "") {
    person.emailAddresses = [{ value: email }];
    has = true;
  }
  if (phone !== "") {
    person.phoneNumbers = [{ value: phone }];
    has = true;
  }
  if (organization !== "" || job !== "") {
    const org: Record<string, string> = {};
    if (organization !== "") {
      org.name = organization;
    }
    if (job !== "") {
      org.title = job;
    }
    person.organizations = [org];
    has = true;
  }
  if (notes !== "") {
    person.biographies = [{ value: notes, contentType: "TEXT_PLAIN" }];
    has = true;
  }
  return has ? person : undefined;
}

function updateFields(person: Record<string, unknown>): string {
  const fields: string[] = [];
  if (arr(person, "names").length > 0) {
    fields.push("names");
  }
  if (arr(person, "emailAddresses").length > 0) {
    fields.push("emailAddresses");
  }
  if (arr(person, "phoneNumbers").length > 0) {
    fields.push("phoneNumbers");
  }
  if (arr(person, "organizations").length > 0) {
    fields.push("organizations");
  }
  if (arr(person, "biographies").length > 0) {
    fields.push("biographies");
  }
  if (arr(person, "addresses").length > 0) {
    fields.push("addresses");
  }
  return fields.join(",");
}

function arr(value: unknown, key: string): unknown[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }
  return value[key];
}

async function updateContact(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "contacts_update(contact_id, …)"));
  if (isResult(opened)) {
    return opened;
  }
  const raw = requireString(args, "contact_id");
  if (raw === undefined || raw.trim() === "") {
    return needArg("contact_id", "contacts_search(query=\"…\") then contacts_update(contact_id, …)");
  }
  const contactID = raw.trim();
  const person = buildPerson(args);
  if (!person) {
    return toolHint("at least one field required (given_name, family_name, email, or phone)", "contacts_update(contact_id, email=…)");
  }
  const resource = personName(contactID);
  let current: unknown;
  try {
    current = await opened.api.get(`${PEOPLE}/${resource}`, { personFields: DETAILED });
  } catch (e) {
    return toolHint(`getting contact ${contactID}: ${errorText(e)}`, "contacts_search(query=\"…\") then contacts_update(contact_id, …)");
  }
  const etag = strField(current, "etag");
  if (etag === "") {
    return errorResult("Unable to get contact etag for update.");
  }
  person.etag = etag;
  const fields = updateFields(person);
  if (fields === "") {
    return toolHint("no fields to update", "contacts_update(contact_id, email=…)");
  }
  let result: unknown;
  try {
    result = await opened.api.patch(`${PEOPLE}/${resource}:updateContact`, person, {
      updatePersonFields: fields,
      personFields: DETAILED,
    });
  } catch (e) {
    return errorResult(`updating contact ${contactID}: ${errorText(e)}`);
  }
  return textResult(`Contact Updated for ${opened.email}:\n\n${formatContact(result, true)}`);
}

async function deleteContact(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "contacts_delete(contact_id=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const raw = requireString(args, "contact_id");
  if (raw === undefined || raw.trim() === "") {
    return needArg("contact_id", "contacts_search(query=\"…\") then contacts_delete(contact_id)");
  }
  const contactID = raw.trim();
  try {
    await opened.api.delete(`${PEOPLE}/${personName(contactID)}:deleteContact`);
  } catch (e) {
    return toolHint(`deleting contact ${contactID}: ${errorText(e)}`, "contacts_search(query=\"…\") then contacts_delete(contact_id)");
  }
  return textResult(`Contact ${contactID} has been deleted for ${opened.email}.`);
}

async function listGroups(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const query: Record<string, string | number> = {
    pageSize: cap(getInt(args, "page_size", 100), 1000),
    groupFields: GROUP_FIELDS,
  };
  const pageToken = getString(args, "page_token", "");
  if (pageToken !== "") {
    query.pageToken = pageToken;
  }
  let result: unknown;
  try {
    result = await opened.api.get(`${PEOPLE}/contactGroups`, query);
  } catch (e) {
    return errorResult(`listing contact groups: ${errorText(e)}`);
  }
  const only = onlyIds(args);
  let groups = arr(result, "contactGroups");
  if (only) {
    groups = groups.filter((group) => {
      const resource = strField(group, "resourceName");
      const id = resource.startsWith("contactGroups/") ? resource.slice("contactGroups/".length) : resource;
      return only.has(id) || only.has(resource);
    });
    return jsonResult(groups.map((group) => {
      const resource = strField(group, "resourceName");
      const id = resource.startsWith("contactGroups/") ? resource.slice("contactGroups/".length) : resource;
      return { id, name: strField(group, "name") };
    }));
  }
  if (groups.length === 0) {
    return textResult(`No contact groups found for ${opened.email}.`);
  }
  let text = `Contact Groups for ${opened.email}:\n\n`;
  for (const group of groups) {
    const resource = strField(group, "resourceName");
    const id = resource.startsWith("contactGroups/") ? resource.slice("contactGroups/".length) : resource;
    const name = strField(group, "name") || "Unnamed";
    const kind = strField(group, "groupType") || "USER_CONTACT_GROUP";
    const members = isRecord(group) && typeof group.memberCount === "number" ? group.memberCount : 0;
    text += `- ${name}\n  ID: ${id}\n  Type: ${kind}\n  Members: ${members}\n\n`;
  }
  const next = strField(result, "nextPageToken");
  if (next !== "") {
    text += `Next page token: ${next}`;
  }
  return textResult(text);
}

async function getGroup(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const groupID = must(args, "group_id");
  if (typeof groupID !== "string") {
    return groupID;
  }
  let result: unknown;
  try {
    result = await opened.api.get(`${PEOPLE}/${groupName(groupID)}`, {
      maxMembers: cap(getInt(args, "max_members", 100), 1000),
      groupFields: GROUP_FIELDS,
    });
  } catch (e) {
    return errorResult(`getting contact group ${groupID}: ${errorText(e)}`);
  }
  const name = strField(result, "name") || "Unnamed";
  const kind = strField(result, "groupType") || "USER_CONTACT_GROUP";
  const count = isRecord(result) && typeof result.memberCount === "number" ? result.memberCount : 0;
  const members = isRecord(result) && Array.isArray(result.memberResourceNames) ? result.memberResourceNames : [];
  let text = `Contact Group Details for ${opened.email}:\n\nName: ${name}\nID: ${groupID}\nType: ${kind}\nTotal Members: ${count}\n`;
  if (members.length > 0) {
    text += `\nMembers (${members.length} shown):\n`;
    for (const member of members) {
      if (typeof member !== "string") {
        continue;
      }
      const id = member.startsWith("people/") ? member.slice("people/".length) : member;
      text += `  - ${id}\n`;
    }
  }
  return textResult(text);
}

async function batchCreate(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const raw = args.contacts;
  if (!Array.isArray(raw) || raw.length === 0) {
    return errorResult("At least one contact must be provided.");
  }
  if (raw.length > 200) {
    return errorResult("Maximum 200 contacts can be created in a batch.");
  }
  const contacts = raw.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const person = buildPerson(item);
    return person ? [{ contactPerson: person }] : [];
  });
  if (contacts.length === 0) {
    return errorResult("No valid contact data provided.");
  }
  let result: unknown;
  try {
    result = await opened.api.post(`${PEOPLE}/people:batchCreateContacts`, { contacts, readMask: BASIC });
  } catch (e) {
    return errorResult(`batch creating contacts: ${errorText(e)}`);
  }
  const created = arr(result, "createdPeople");
  let text = `Batch Create Results for ${opened.email}:\n\nCreated ${created.length} contacts:\n\n`;
  for (const item of created) {
    if (isRecord(item) && item.person) {
      text += `${formatContact(item.person, false)}\n\n`;
    }
  }
  return textResult(text);
}

async function batchUpdate(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const raw = args.updates;
  if (!Array.isArray(raw) || raw.length === 0) {
    return errorResult("At least one update must be provided.");
  }
  if (raw.length > 200) {
    return errorResult("Maximum 200 contacts can be updated in a batch.");
  }
  const names: string[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const id = typeof item.contact_id === "string" ? item.contact_id : "";
    if (id === "") {
      return errorResult("Each update must include a contact_id.");
    }
    names.push(personName(id));
  }
  let fetched: unknown;
  try {
    fetched = await opened.api.get(`${PEOPLE}/people:batchGet`, { resourceNames: names, personFields: "metadata" });
  } catch (e) {
    return errorResult(`fetching contact etags: ${errorText(e)}`);
  }
  const etags = new Map<string, string>();
  for (const row of arr(fetched, "responses")) {
    const person = isRecord(row) ? row.person : undefined;
    const resource = strField(person, "resourceName");
    const etag = strField(person, "etag");
    if (resource !== "" && etag !== "") {
      etags.set(resource, etag);
    }
  }
  const contacts: Record<string, unknown> = {};
  const mask = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || typeof item.contact_id !== "string") {
      continue;
    }
    const resource = personName(item.contact_id);
    const etag = etags.get(resource);
    if (!etag) {
      continue;
    }
    const person = buildPerson(item);
    if (!person) {
      continue;
    }
    person.resourceName = resource;
    person.etag = etag;
    for (const field of updateFields(person).split(",")) {
      if (field !== "") {
        mask.add(field);
      }
    }
    contacts[resource] = person;
  }
  if (Object.keys(contacts).length === 0) {
    return errorResult("No valid update data provided.");
  }
  let result: unknown;
  try {
    result = await opened.api.post(`${PEOPLE}/people:batchUpdateContacts`, {
      contacts,
      updateMask: [...mask].sort().join(","),
      readMask: BASIC,
    });
  } catch (e) {
    return errorResult(`batch updating contacts: ${errorText(e)}`);
  }
  const updated = isRecord(result) && isRecord(result.updateResult) ? Object.values(result.updateResult) : [];
  let text = `Batch Update Results for ${opened.email}:\n\nUpdated ${updated.length} contacts:\n\n`;
  for (const row of updated) {
    if (isRecord(row) && row.person) {
      text += `${formatContact(row.person, false)}\n\n`;
    }
  }
  return textResult(text);
}

async function batchDelete(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const ids = mustSlice(args, "contact_ids");
  if (!Array.isArray(ids)) {
    return ids;
  }
  if (ids.length === 0) {
    return errorResult("At least one contact ID must be provided.");
  }
  if (ids.length > 500) {
    return errorResult("Maximum 500 contacts can be deleted in a batch.");
  }
  try {
    await opened.api.post(`${PEOPLE}/people:batchDeleteContacts`, { resourceNames: ids.map(personName) });
  } catch (e) {
    return errorResult(`batch deleting contacts: ${errorText(e)}`);
  }
  return textResult(`Batch deleted ${ids.length} contacts for ${opened.email}.`);
}

async function createGroup(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const name = must(args, "name");
  if (typeof name !== "string") {
    return name;
  }
  let result: unknown;
  try {
    result = await opened.api.post(`${PEOPLE}/contactGroups`, { contactGroup: { name } });
  } catch (e) {
    return errorResult(`creating contact group: ${errorText(e)}`);
  }
  const resource = strField(result, "resourceName");
  const id = resource.startsWith("contactGroups/") ? resource.slice("contactGroups/".length) : resource;
  const created = strField(result, "name") || name;
  const kind = strField(result, "groupType") || "USER_CONTACT_GROUP";
  return textResult(`Contact Group Created for ${opened.email}:\n\nName: ${created}\nID: ${id}\nType: ${kind}\n`);
}

async function updateGroup(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const groupID = must(args, "group_id");
  if (typeof groupID !== "string") {
    return groupID;
  }
  const name = must(args, "name");
  if (typeof name !== "string") {
    return name;
  }
  let result: unknown;
  try {
    result = await opened.api.put(`${PEOPLE}/${groupName(groupID)}`, { contactGroup: { name } });
  } catch (e) {
    return errorResult(`updating contact group ${groupID}: ${errorText(e)}`);
  }
  return textResult(`Contact Group Updated for ${opened.email}:\n\nName: ${strField(result, "name") || name}\nID: ${groupID}\n`);
}

async function deleteGroup(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const groupID = must(args, "group_id");
  if (typeof groupID !== "string") {
    return groupID;
  }
  const deleteContacts = getBoolOnly(args, "delete_contacts", false);
  try {
    await opened.api.delete(`${PEOPLE}/${groupName(groupID)}`, { deleteContacts });
  } catch (e) {
    return errorResult(`deleting contact group ${groupID}: ${errorText(e)}`);
  }
  const extra = deleteContacts ? " Contacts in the group were also deleted." : " Contacts in the group were preserved.";
  return textResult(`Contact group ${groupID} has been deleted for ${opened.email}.${extra}`);
}

async function modifyMembers(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, "message");
  if (isResult(opened)) {
    return opened;
  }
  const groupID = must(args, "group_id");
  if (typeof groupID !== "string") {
    return groupID;
  }
  const add = getStringSlice(args, "add_contact_ids") ?? [];
  const remove = getStringSlice(args, "remove_contact_ids") ?? [];
  if (add.length === 0 && remove.length === 0) {
    return errorResult("At least one of add_contact_ids or remove_contact_ids must be provided.");
  }
  const body: Record<string, string[]> = {};
  if (add.length > 0) {
    body.resourceNamesToAdd = add.map(personName);
  }
  if (remove.length > 0) {
    body.resourceNamesToRemove = remove.map(personName);
  }
  let result: unknown;
  try {
    result = await opened.api.post(`${PEOPLE}/${groupName(groupID)}/members:modify`, body);
  } catch (e) {
    return errorResult(`modifying contact group members ${groupID}: ${errorText(e)}`);
  }
  let text = `Contact Group Members Modified for ${opened.email}:\n\nGroup: ${groupID}\n`;
  if (add.length > 0) {
    text += `Added: ${add.length} contacts\n`;
  }
  if (remove.length > 0) {
    text += `Removed: ${remove.length} contacts\n`;
  }
  const missing = stringList(result, "notFoundResourceNames");
  if (missing.length > 0) {
    text += `\nNot found: ${missing.join(", ")}\n`;
  }
  const stuck = stringList(result, "canNotRemoveLastContactGroupResourceNames");
  if (stuck.length > 0) {
    text += `\nCannot remove (last group): ${stuck.join(", ")}\n`;
  }
  return textResult(text);
}

function must(args: Record<string, unknown>, key: string): string | ToolResult {
  try {
    return requireArgString(args, key);
  } catch (e) {
    if (e instanceof ArgTypeError) {
      return errorResult(e.message);
    }
    throw e;
  }
}

function mustSlice(args: Record<string, unknown>, key: string): string[] | ToolResult {
  if (!hasKey(args, key)) {
    return errorResult(`required argument ${JSON.stringify(key)} not found`);
  }
  const value = args[key];
  if (!Array.isArray(value)) {
    return errorResult(`argument ${JSON.stringify(key)} is not a string slice`);
  }
  const out: string[] = [];
  let i = 0;
  for (const item of value) {
    if (typeof item !== "string") {
      return errorResult(`item ${i} in argument ${JSON.stringify(key)} is not a string`);
    }
    out.push(item);
    i += 1;
  }
  return out;
}

function stringList(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }
  return value[key].filter((item): item is string => typeof item === "string");
}
