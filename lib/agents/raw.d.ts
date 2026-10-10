/** Vite `?raw` imports. `vite/client` is not in tsconfig `types`. */
declare module "*?raw" {
  const s: string;
  export default s;
}
