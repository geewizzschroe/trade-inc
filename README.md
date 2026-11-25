# Trade Inc

An incremental game with a trade route theme. Plain HTML/JS, installable as a web app (PWA).

Play: https://geewizzschroe.github.io/trade-inc/

## Layout
- `data/town.json`: town stage content (buildings, goods, prices, upgrades, achievements)
- `js/town.js`: pure town-stage logic, no DOM (portable to another engine later)
- `js/townmap.js`: canvas town map, route line and merchant
- `js/ui.js`, `js/fx.js`, `style.css`: panels, input, sounds, vibration, animations
- `js/storage.js`: local save; saves are plain JSON and can be exported/imported from the menu
- `test/town.test.js`: run with `node test/town.test.js`
