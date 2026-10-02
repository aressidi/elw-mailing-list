// Read-only Google Sheets access via the `gog` CLI with an on-disk cache.
//
// Used by scripts/import-master-data-2025.ts, which reads the consolidated
// tab plus every tab of ~26 parent workbooks (~190 tabs). Google's Sheets
// quota is 60 read requests/minute/user, so calls are throttled and retried
// on 429, and every response is cached so a re-run (or a crash mid-import)
// doesn't re-fetch anything. Delete the cache dir (or pass --refresh to the
// importer) to force a re-fetch.

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export const GOG_ACCOUNT = 'alex@eastonlandworks.com';
const MIN_CALL_INTERVAL_MS = 1100;
const MAX_RETRIES = 6;
const ROW_CHUNK = 10000;

export type RenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE';

export interface TabInfo {
  title: string;
  gid: number;
  rows: number;
  cols: number;
  isGrid: boolean;
}

export interface WorkbookInfo {
  id: string;
  title: string;
  tabs: TabInfo[];
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function columnLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export class GogSheetsCache {
  private lastCallAt = 0;
  public apiCalls = 0;

  constructor(private cacheDir: string, private refresh = false) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  private gogJson(args: string[]): any {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCallAt + MIN_CALL_INTERVAL_MS - Date.now();
      if (wait > 0) sleepSync(wait);
      this.lastCallAt = Date.now();
      this.apiCalls++;
      try {
        const out = execFileSync('gog', [...args, '--json', '--readonly'], {
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GOG_ACCOUNT },
        });
        return JSON.parse(out);
      } catch (e: any) {
        const msg = `${e.stderr ?? ''}${e.stdout ?? ''}${e.message ?? ''}`;
        const retryable = /429|rateLimitExceeded|RESOURCE_EXHAUSTED|50[023]|ECONNRESET|ETIMEDOUT/i.test(msg);
        if (!retryable || attempt >= MAX_RETRIES) throw new Error(`gog ${args.slice(0, 3).join(' ')} failed: ${msg.slice(0, 400)}`);
        sleepSync(Math.min(15000 * (attempt + 1), 65000));
      }
    }
  }

  private cached<T>(file: string, produce: () => T): T {
    const full = path.join(this.cacheDir, file);
    if (!this.refresh && fs.existsSync(full)) return JSON.parse(fs.readFileSync(full, 'utf-8'));
    const value = produce();
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(value));
    return value;
  }

  metadata(spreadsheetId: string): WorkbookInfo {
    return this.cached(`${spreadsheetId}/metadata.json`, () => {
      const m = this.gogJson(['sheets', 'metadata', spreadsheetId]);
      return {
        id: spreadsheetId,
        title: m.title ?? '',
        tabs: (m.sheets ?? []).map((s: any) => ({
          title: s.properties.title,
          gid: s.properties.sheetId ?? 0,
          rows: s.properties.gridProperties?.rowCount ?? 0,
          cols: s.properties.gridProperties?.columnCount ?? 0,
          isGrid: (s.properties.sheetType ?? 'GRID') === 'GRID',
        })),
      };
    });
  }

  /**
   * Whole-tab values, row-aligned to the sheet (index 0 = sheet row 1).
   * Fetched in row chunks of `chunkRows` (the 2026 importer's 500-row batch
   * pattern, with a larger default for parent tabs).
   */
  tabValues(spreadsheetId: string, tab: TabInfo, render: RenderOption, chunkRows = ROW_CHUNK): any[][] {
    return this.cached(`${spreadsheetId}/${tab.gid}.${render}.json`, () => {
      const rows: any[][] = [];
      const lastCol = columnLetter(Math.max(tab.cols, 1));
      const quoted = `'${tab.title.replace(/'/g, "''")}'`;
      for (let start = 1; start <= tab.rows; start += chunkRows) {
        const end = Math.min(start + chunkRows - 1, tab.rows);
        const res = this.gogJson(['sheets', 'get', spreadsheetId, `${quoted}!A${start}:${lastCol}${end}`, `--render=${render}`]);
        const values: any[][] = res.values ?? [];
        // The API trims trailing empty rows per range; pad so later chunks
        // stay aligned to their sheet row numbers.
        for (let i = 0; i < end - start + 1; i++) rows.push(values[i] ?? []);
      }
      while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
      return rows;
    });
  }
}
