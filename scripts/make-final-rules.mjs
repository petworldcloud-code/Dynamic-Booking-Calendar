// Builds firestore.rules.final from firestore.rules (the transition rules) by removing the old
// single-calendar paths. Run: node scripts/make-final-rules.mjs
// Edit firestore.rules, never the .final file; re-run this after every change.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('firestore.rules', 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
let s = src.replace(/\r\n/g, '\n');

const begin = s.indexOf('    // LEGACY-BEGIN');
const end = s.indexOf('    // LEGACY-END');
if (begin < 0 || end < begin) throw new Error('LEGACY-BEGIN / LEGACY-END markers not found in firestore.rules');

s = s.slice(0, begin)
  + '    // The old single-calendar paths (bookings, blockedDates, notifyRecipients, settings/slots|notifications)\n'
  + '    // are closed: everything now lives under calendars/{cal}. The catch-all at the bottom denies them.\n'
  + s.slice(end + '    // LEGACY-END\n'.length);

s = s.replace(/\/\/ TRANSITION rules:[\s\S]*?service cloud\.firestore/,
  '// FINAL rules: only the calendars/{cal}/... paths. Publish after the move to calendars is finished and checked.\n'
  + '// GENERATED from firestore.rules by scripts/make-final-rules.mjs - do not edit by hand.\n'
  + 'service cloud.firestore');

// The old-account helper has no use once the old paths are gone.
s = s.replace(/\n    \/\/ Old company accounts[^\n]*\n    function isLegacyUser\(\)[^\n]*\n/, '\n');

writeFileSync('firestore.rules.final', s.replace(/\n/g, eol));
console.log('Wrote firestore.rules.final');
