/**
 * Sheets client. TypeScript port of sheets_client/.
 *
 * Interface + MockSheetsClient (tests/dev) + RealSheetsClient (googleapis,
 * lazy import). Writes always use valueInputOption=RAW and sanitize
 * leading = + - @ (formula-injection guard, ported from the Python build).
 */

export interface SheetRow {
  [key: string]: string;
}

export interface SheetsClient {
  readTab(tabName: string): Promise<SheetRow[]>;
  /** Append rows; values written RAW with formula-injection sanitization. */
  appendRows(tabName: string, rows: string[][]): Promise<void>;
}

function sanitizeCell(value: string): string {
  // Leading = + - @ could be interpreted as a formula; prefix with a
  // single quote so Sheets stores it as text (RAW write + sanitize).
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

// ---------------------------------------------------------------------------
// Mock (tests / dev)
// ---------------------------------------------------------------------------

export class MockSheetsClient implements SheetsClient {
  private tabs = new Map<string, SheetRow[]>();
  appended: Array<{ tab: string; rows: string[][] }> = [];

  setTab(tabName: string, rows: SheetRow[]): void {
    this.tabs.set(tabName, rows);
  }

  async readTab(tabName: string): Promise<SheetRow[]> {
    return this.tabs.get(tabName) || [];
  }

  async appendRows(tabName: string, rows: string[][]): Promise<void> {
    const clean = rows.map((r) => r.map(sanitizeCell));
    this.appended.push({ tab: tabName, rows: clean });
  }
}

// ---------------------------------------------------------------------------
// Real (googleapis, lazy)
// ---------------------------------------------------------------------------

export class RealSheetsClient implements SheetsClient {
  private accessToken: string;
  private spreadsheetId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sheets: any = null;

  constructor(opts: { accessToken: string; spreadsheetId: string }) {
    this.accessToken = opts.accessToken;
    this.spreadsheetId = opts.spreadsheetId;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async api(): Promise<any> {
    if (!this.sheets) {
      const { google } = await import("googleapis");
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: this.accessToken });
      this.sheets = google.sheets({ version: "v4", auth });
    }
    return this.sheets;
  }

  async readTab(tabName: string): Promise<SheetRow[]> {
    const sheets = await this.api();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: tabName,
    });
    const values: string[][] = res.data.values || [];
    if (values.length === 0) return [];
    const [header, ...rows] = values;
    return rows.map((r) => {
      const row: SheetRow = {};
      header.forEach((h, i) => {
        row[h] = r[i] || "";
      });
      return row;
    });
  }

  async appendRows(tabName: string, rows: string[][]): Promise<void> {
    const sheets = await this.api();
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: tabName,
      valueInputOption: "RAW",
      requestBody: {
        values: rows.map((r) => r.map(sanitizeCell)),
      },
    });
  }
}
