import { OCTOBER_2026_TIMETABLE } from '../lib/october-2026-timetable';
import * as fs from 'fs';

const excelDays = JSON.parse(
  fs.readFileSync(
    'C:/Users/Vaibhav/.gemini/antigravity-ide/brain/45ad983d-f67f-45c8-8b1b-723e2effb422/scratch/excel_timetable.json',
    'utf-8'
  )
);
const excelMap = new Map<string, any>(excelDays.map((d: any) => [d.date, d]));

console.log('TS dates count:', OCTOBER_2026_TIMETABLE.length);
console.log('Excel dates count:', excelDays.length);

function norm(s: string) {
  if (!s) return '';
  return s
    .replace(/\+/g, ' + ')
    .replace(/\(/g, ' (')
    .replace(/\)/g, ') ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

let diffs = 0;
for (const day of OCTOBER_2026_TIMETABLE) {
  const ex = excelMap.get(day.date);
  if (!ex) {
    console.log('Date missing in Excel:', day.date);
    diffs++;
    continue;
  }
  for (const cat of ['Pre-primary', 'Primary', 'Secondary'] as const) {
    const tsEntry = day.menus[cat];
    const exStr = ex[cat];
    const isExHoliday = exStr.toLowerCase().includes('holiday');
    if (tsEntry.isHoliday !== isExHoliday) {
      console.log(`Holiday diff on ${day.date} ${cat}: TS=${tsEntry.isHoliday}, Excel=${exStr}`);
      diffs++;
    } else if (!isExHoliday) {
      if (norm(tsEntry.dish) !== norm(exStr)) {
        console.log(`Dish diff on ${day.date} ${cat}:\n  TS:    "${tsEntry.dish}"\n  Excel: "${exStr}"`);
        diffs++;
      }
    }
  }
}
console.log('Total differences found:', diffs);
