const express = require('express');
const path    = require('path');
const handler = require('./api/index');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/examiner', (req, res) => res.sendFile(path.join(__dirname, 'public', 'examiner.html')));
app.get('/peer',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'peer.html')));
app.post('/api', handler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FYP server running on port ${PORT}`));
