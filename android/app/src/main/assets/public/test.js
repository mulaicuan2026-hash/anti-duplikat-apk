const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
setTimeout(() => {
  console.log('supabase typeof:', typeof dom.window.supabase);
  if (dom.window.document.body.innerHTML.length < 100) {
      console.log('Body is empty!');
  } else {
      console.log('Body has content');
  }
}, 2000);
