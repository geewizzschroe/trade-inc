// Browser storage for saves and settings. Saves are the JSON produced by engine.serialize.
const SAVE_KEY = 'tradeinc.save';
const SETTINGS_KEY = 'tradeinc.settings';

export function loadSave() {
  try { return localStorage.getItem(SAVE_KEY); } catch { return null; }
}
export function writeSave(json) {
  try { localStorage.setItem(SAVE_KEY, json); return true; } catch { return false; }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}
export function loadSettings() {
  try { return { sound: true, haptics: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { sound: true, haptics: true }; }
}
export function writeSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
