/**
 * lib/sheets.ts: Sheets entry point. Re-exports the client interface, the
 * mock (tests/dev), and the real googleapis client. Writes always use
 * valueInputOption=RAW with formula-injection sanitization. Python
 * equivalent: the sheets_client/ package.
 */
export {
  MockSheetsClient,
  RealSheetsClient,
  type SheetRow,
  type SheetsClient,
} from "./sheets/client";
