# Trade Inc

An incremental game with a trade route theme. Plain HTML/JS, installable as a web app (PWA).

Play: https://geewizzschroe.github.io/trade-inc/

## Layout
- `data/content.json`: routes, goods, costs, timings (all balance numbers live here)
- `js/engine.js`: pure game logic, no DOM (portable to another engine later)
- `js/ui.js`, `js/fx.js`, `style.css`: rendering, input, sounds, vibration, animations
- `js/storage.js`: local save; saves are plain JSON and can be exported/imported from the menu
- `test/engine.test.js`: run with `node test/engine.test.js`
