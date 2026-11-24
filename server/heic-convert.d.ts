// heic-convert ships no types. Only what server/fileText.ts uses is declared.
declare module 'heic-convert' {
  export default function convert(options: { buffer: Uint8Array; format: 'JPEG' | 'PNG'; quality?: number }): Promise<ArrayBuffer>
}
