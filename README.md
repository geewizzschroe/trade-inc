# Trade Inc

An incremental game with a trade route theme. Plain HTML/JS, installable as a web app (PWA).

Play: https://geewizzschroe.github.io/trade-inc/

## Layout
- `data/world.json`: all content (towns and their buildings, goods, prices, upgrades, achievements)
- `js/game.js`: pure game logic, no DOM (portable to another engine later)
- `js/townmap.js`, `js/landmap.js`: canvas views of a town and of the land
- `js/ui.js`, `js/fx.js`, `style.css`: panels, input (tap, trace, pinch), sounds, vibration, animations
- `js/storage.js`: local save; saves are plain JSON and can be exported/imported from the menu
- `test/game.test.js`: run with `node test/game.test.js`
