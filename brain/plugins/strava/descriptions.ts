/** Tool descriptions copied from the Go server's mcp.NewTool registrations. */
export const descriptions = {
  activities_list: `Retrieves the authenticated athlete's activities.

**Key for Enrichment Workflow**: Use this to find activities from specific time periods, especially "today's run" or recent activities that need updating.

**OAuth Scope**: Requires activity:read. Note: "Only Me" privacy activities require activity:read_all scope.

Features:
- Filter by date range using 'before' and 'after' epoch timestamps
- Paginate through results (max 200 per page)
- Returns summary information for each activity (not full details)

Common use cases:
- Find today's activities: Set 'after' to today's start timestamp
- Find this week's activities: Set 'after' to the start of the week
- Browse recent activities: Use default parameters

**Privacy Note**: Only returns activities the authenticated athlete has permission to view based on privacy settings and OAuth scope.

Example: To find today's runs, calculate today's start epoch timestamp and use it as the 'after' parameter.`,
  activities_get: `Retrieves detailed information about a specific activity by its ID.

Returns comprehensive activity data including:
- Full description and name
- Detailed statistics (distance, time, elevation, speed, heart rate, etc.)
- Gear information
- Splits and laps
- Photos and kudos
- Device information

Use this after 'activities_list' to get full details about a specific activity before updating it.`,
  activities_create: `Creates a new manual activity on Strava.

**OAuth Scope**: Requires activity:write permission.

Use this when:
- Adding activities that weren't automatically recorded
- Logging cross-training or activities from non-connected devices
- Backdating activities that were missed
- Creating placeholder activities for training logs

**Required Fields**:
- name: Activity title
- sport_type: Type of activity (Run, Ride, Swim, etc.)
- start_date_local: When the activity started (ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ)
- elapsed_time: Duration in seconds

**Optional but Recommended**:
- distance: Distance in meters
- description: Detailed notes about the activity
- trainer: Whether it was indoors on a trainer (boolean)
- commute: Whether this was a commute (boolean)

**Valid Sport Types**: Run, TrailRun, Walk, Hike, VirtualRun, Ride, MountainBikeRide, GravelRide, EBikeRide, VirtualRide, Handcycle, Swim, Crossfit, Elliptical, Rowing, StairStepper, WeightTraining, Workout, Yoga, and many more.

**Example**: Logging a gym workout that wasn't tracked: name="Strength Training", sport_type="WeightTraining", elapsed_time=3600 (1 hour).`,
  activities_update: `**[CRITICAL - PRIMARY ENRICHMENT TOOL]** Updates an existing Strava activity.

**OAuth Scope**: Requires activity:write permission.

**This is THE most important tool for the enrichment workflow.** Use this to transform basic auto-imported activities (especially from Apple Watch) into detailed, meaningful training logs.

**The Enrichment Pattern:**
1. Use 'activities_list' with 'after' parameter to find today's or recent activities
2. Identify the activity that needs enrichment (often has generic names like "Morning Run")
3. Use 'activities_update' to add:
   - Meaningful name (e.g., "Progressive Long Run - 10K" instead of "Morning Run")
   - Detailed description (weather, effort level, training notes, how you felt, route details)
   - Correct sport_type if needed (Run vs TrailRun vs VirtualRun)

**Supports partial updates**: Only provide the fields you want to change. All other fields remain unchanged.

**Apple Watch Enhancement Examples:**
- Generic "Afternoon Run" -> "Hill Repeats Workout - 8x400m"
- No description -> "Perfect weather (60F). Focused on form. Felt strong on the hills. HR avg 155 bpm. Recovery: 2 min between reps."
- Type: Run -> sport_type: TrailRun (if it was on trails)

**Available Fields:**
- name: Activity title
- description: Detailed training notes (weather, effort, feelings, splits, etc.)
- sport_type: Accurate sport classification
- trainer: Mark as indoor if needed
- commute: Mark as commute
- hide_from_home: Hide from feed
- gear_id: Associate with specific shoes/bike

**Coach's Perspective**: Rich descriptions help track training patterns, identify what works, and review progress over time. Transform data into insights!`,
  activities_get_zones: `Retrieves the zones of a given activity.

**Note**: This is a **Strava Summit feature**. Requires appropriate activity:read scope based on privacy settings.

Returns time spent in different intensity zones:
- Heart rate zones (if HR data available)
- Power zones (if power data available)

Zone response includes:
- Distribution buckets showing time in each zone
- Whether zones are sensor-based vs calculated
- Whether custom zones or default zones are used
- Zone score and max values

Useful for:
- Analyzing training intensity distribution
- Verifying if an activity met zone targets (e.g., "Did I stay in Zone 2?")
- Understanding effort distribution across an activity
- Performance coaching and analysis
- Tracking training load by zone

**Coaching Value**: Essential for verifying that easy runs stayed easy, tempo runs hit the right intensity, and interval workouts achieved target zones.`,
  athlete_get: `Retrieves the authenticated athlete's profile information.

**OAuth Scope**: Requires profile:read_all for detailed representation.

Returns comprehensive profile data including:
- Name and username
- Location (city, state, country)
- Profile pictures (avatar, profile medium, profile)
- Account type (premium/summit status)
- Account creation and update dates
- Weight (if profile:read_all scope)
- Basic settings and preferences

Use this to:
- Get the athlete's ID for other API calls
- Display profile information
- Check account status
- Personalize responses with the athlete's name ("Hi Sarah!")

This is useful when you need to reference the athlete by name or understand their account status.`,
  athlete_get_stats: `Retrieves comprehensive statistics about an athlete's activities.

**OAuth Scope**: Requires profile:read_all. Can only retrieve stats for the authenticated athlete.

**Performance Coaching Value**: Essential for understanding training volume, trends, and progress over different time periods.

Returns activity totals broken down by:
- **Recent** (last 4 weeks)
- **Year-to-date** (current calendar year)
- **All-time** (entire Strava history)

For each period, provides data for three activity types:
- **Running**: Distance, time, elevation, count
- **Cycling**: Distance, time, elevation, count
- **Swimming**: Distance, time, count

Statistics include:
- Total distance (meters)
- Total moving time (seconds)
- Total elevation gain (meters)
- Activity count
- Achievement count

**Coaching Applications**:
- Track training volume week over week
- Compare current year progress to goals
- Identify trends (increasing/decreasing volume)
- Assess training consistency
- Plan future workouts based on recent load
- Celebrate milestones and achievements

**Example Insights**:
- "You've run 150km this month, up 20% from last month"
- "YTD you've climbed 5,000m - halfway to your annual goal!"
- "Recent activity shows consistent 4x/week training"`,
  activities_get_streams: `**[TELEMETRY & DEEP ANALYSIS]** Retrieves time-series sensor data (streams) from an activity.

**Performance Coach's Secret Weapon**: While activity summaries give you averages, streams give you the complete story - every data point recorded during the activity. Essential for understanding pacing strategy, heart rate response, power distribution, and elevation profiles.

**Available Stream Types:**

**Core Metrics:**
- **time**: Time elapsed in seconds from start (array of timestamps)
- **distance**: Distance in meters at each point
- **latlng**: GPS coordinates [latitude, longitude] for mapping route
- **altitude**: Elevation in meters at each point

**Performance Metrics:**
- **velocity_smooth**: Smoothed speed in meters/second (better than raw GPS)
- **grade_smooth**: Smoothed gradient percentage (positive = uphill, negative = downhill)
- **moving**: Boolean indicating if athlete was moving (vs stopped)

**Physiological Data:**
- **heartrate**: Heart rate in beats per minute (if HR monitor used)
- **cadence**: Running cadence (steps/min) or cycling cadence (RPM)
- **temp**: Temperature in Celsius

**Power Data (cycling/running):**
- **watts**: Power output in watts (if power meter used)

**Analysis Use Cases:**

1. **Pacing Analysis**:
   - Identify if pacing was even, positive split, or negative split
   - Find where pace dropped off (fatigue points)
   - Compare intended vs actual pace strategy

2. **Heart Rate Analysis**:
   - Verify time in each HR zone
   - Check HR response to elevation changes
   - Identify cardiac drift (HR rising at same pace)
   - Recovery analysis (how fast HR drops)

3. **Elevation Strategy**:
   - Analyze power/effort on climbs vs descents
   - Identify elevation gain distribution
   - Understand route difficulty profile

4. **Efficiency Metrics**:
   - Cadence consistency
   - Power distribution (variability)
   - Speed-to-HR relationship

5. **Route Visualization**:
   - Map the exact route taken
   - Identify interesting segments
   - Plan future routes

**Performance Coaching Workflow**:
1. Get activity streams after an important workout or race
2. Analyze the data to understand execution
3. Provide specific feedback: "Your HR spiked to 175 at km 5 (the big hill) but recovered well"
4. Use insights to plan future training: "Your pacing was perfect for the first half but dropped 15s/km in the second half - let's work on endurance"

**Technical Notes**:
- Not all streams available for all activities (depends on device/sensors used)
- Data points are time-aligned across all streams
- Arrays are same length - index [i] in time corresponds to index [i] in all other streams
- Request only needed streams for efficiency (or omit 'keys' for all available)
- **Resolution**: Strava may return data at different resolutions (low, medium, high) depending on original recording frequency
- **OAuth Scope**: Requires activity:read for Everyone/Followers activities, activity:read_all for Only Me activities

**Pro Tip**: Combine streams for advanced insights:
- velocity_smooth + heartrate = aerobic efficiency
- grade_smooth + watts = climbing power
- distance + time + heartrate = heart rate zones over race segments`,
  clubs_list_activities: `Retrieves recent activities from members of a specific club.

**OAuth Scope**: Requires read scope. Only shows activities visible based on member privacy settings.

Clubs on Strava are groups of athletes who share activities, compete on leaderboards, and stay connected. This tool lets you see what club members have been up to.

Returns activity summaries including:
- Activity details (name, distance, time, elevation, etc.)
- Athlete information (name of club member who did the activity)
- Activity statistics and metadata

**Use Cases:**
- Monitor club activity and engagement
- See what training club members are doing
- Find popular routes or workout types
- Track club challenges or group goals
- Encourage and support club members

**Coaching Applications:**
- Review team training consistency
- Identify athletes who might need check-ins
- Celebrate club achievements
- Coordinate group workouts based on activity patterns

Note: Only shows activities from club members who have their privacy settings set to allow club visibility.`,
  uploads_create: `Uploads a new activity file to Strava.

**OAuth Scope**: Requires activity:write permission.

Supports uploading activity files in these formats:
- **FIT** (.fit) - Garmin and most GPS watches
- **TCX** (.tcx) - Training Center XML format
- **GPX** (.gpx) - GPS Exchange Format
- All formats can be gzip compressed (.gz)

**Upload Process:**
1. File is read from the local file path provided
2. File format is auto-detected from extension (or use data_type override)
3. File is uploaded and queued for processing
4. Strava processes the file (can take a few seconds to minutes)
5. Once processed, an activity is created
6. Use 'uploads_get' to check processing status

**Parameters:**
- file: Local file path to the activity file (.fit, .tcx, .gpx, or gzip compressed variants)
- data_type: Optional file format override (fit, tcx, gpx, fit.gz, tcx.gz, gpx.gz). Auto-detected from extension if omitted.
- name: Optional activity name (can also be set via activities_update after processing)
- description: Optional description
- trainer: Mark as trainer activity
- commute: Mark as commute

**Use Cases:**
- Import activities from non-integrated devices
- Bulk upload historical activities
- Upload activities from custom tracking apps
- Migrate data from other platforms

**Important Notes:**
- Uploads are processed asynchronously
- Check upload status with 'uploads_get' using the returned upload ID
- Once processed, the activity ID is available for further updates
- Duplicate activities may be automatically detected and rejected

**Typical Workflow:**
1. Upload file -> get upload ID
2. Poll 'uploads_get' to check status
3. When status is complete, get the activity_id
4. Use activity tools to view or update the created activity`,
  uploads_get: `Retrieves the status of a file upload.

**OAuth Scope**: Requires activity:read permission.

After uploading an activity file with 'uploads_create', use this tool to check the processing status.

**Upload Statuses:**
- "Your activity is still being processed." - Processing in progress
- "Your activity is ready." - Successfully processed
- "There was an error processing your activity." - Processing failed

**Response Fields:**
- id: Upload ID
- external_id: External identifier if provided
- error: Error message if processing failed
- status: Current status message
- activity_id: The created activity's ID (only present when successfully processed)

**Typical Usage:**
1. Upload a file with 'uploads_create'
2. Get the upload ID from the response
3. Poll this endpoint to check status
4. Once activity_id is present, use activity tools to view or modify

**Coaching Workflow:**
After an athlete uploads a workout file:
1. Check upload status
2. When ready, get the activity details
3. Analyze and provide feedback
4. Enrich with descriptions and coaching notes`,
  routes_list: `Lists the authenticated athlete's saved Strava routes (planned maps).

**OAuth Scope**: Requires read. Private routes require read_all.

Returns route summaries including:
- Route id, name, and description
- Distance (meters) and elevation gain (meters)
- Estimated moving time
- Sport type (ride / run)
- Map summary polyline
- Starred / private flags
- Created and updated timestamps

Use this to:
- Find a saved route by name after the athlete built it in Strava
- Get route ids to pass to routes_get
- Review planned maps before a workout

Pagination: page (default 1) and per_page (1-200, default 30).`,
  routes_get: `Retrieves a saved Strava route (planned map) by id, including map polylines.

**OAuth Scope**: Requires read. Private routes require read_all.

Returns full route detail:
- Name, description, distance, elevation, estimated time
- map.summary_polyline and map.polyline (encoded Google polylines)
- Matched segments when present
- Athlete who created the route

Use this after routes_list, or after urls_resolve when a share link points at a route.

For a completed activity's GPS track, use activities_get / activities_get_streams instead.`,
  urls_resolve: `Resolves a Strava URL — including shortened strava.app.link share links — to a resource and optionally fetches it.

Strava share sheets often produce short links the model cannot open. This tool follows those redirects (Strava/Branch hosts only) and returns:

- type: activity, route, segment, athlete, or club
- id: numeric Strava id
- canonical_url: https://www.strava.com/{type}s/{id}
- resource: the API object when fetch is true (default)

**Getting a map from a share link**:
1. Pass the shortened or full URL
2. When type is route, resource includes map.summary_polyline / map.polyline
3. When type is activity, resource includes the activity map polyline

Also accepts already-canonical URLs (www.strava.com/routes/…, /activities/…).

**OAuth Scope**: Fetching the resource uses the same scopes as the underlying GET (read / read_all / activity:read).`,
} as const;
