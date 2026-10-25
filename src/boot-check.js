// Classic (non-module) script: if the game hasn't started after a few seconds,
// explain why instead of leaving a blank page. The usual cause is opening
// index.html straight from disk, where browsers block ES modules.
(function () {
  setTimeout(function () {
    if (window.kittleSkies) return;
    var fromDisk = location.protocol === 'file:' && !window.KS_SINGLE_FILE;
    var box = document.createElement('div');
    box.className = 'boot-error';
    box.innerHTML = fromDisk
      ? '<h1>Kittle Skies needs a tiny web server</h1>' +
        '<p>Browsers block JavaScript modules when a page is opened straight from disk.</p>' +
        '<p>Either run <code>npm start</code> (or <code>python3 -m http.server</code>) in this folder and open ' +
        '<code>http://localhost:8000</code>, or build the single-file offline version with ' +
        '<code>npm run build:offline</code> and double-click <code>dist/kittle-skies.html</code>.</p>'
      : '<h1>Kittle Skies could not start</h1><p>Your browser may be too old. Try a current version of Chrome, Edge, Firefox or Safari.</p>';
    document.body.appendChild(box);
  }, 4000);
})();
