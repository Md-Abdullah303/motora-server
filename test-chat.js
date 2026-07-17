const http = require('http');

const data = JSON.stringify({
  messages: [
    { role: "model", parts: [{ text: "Hello! I am MOTORA AI." }] },
    { role: "user", parts: [{ text: "hi" }] }
  ]
});

const req = http.request('http://localhost:4000/api/ai/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, body));
});

req.on('error', e => console.error('Error:', e.message));
req.write(data);
req.end();
