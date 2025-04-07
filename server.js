const express = require('express');
const exphbs = require('express-handlebars');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Handlebars with custom helpers
const hbs = exphbs.create({
  extname: '.hbs',
  defaultLayout: 'main',
  helpers: {
    eq: function (a, b) {
      return a === b;
    }
  }
});
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Session Middleware
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// SQLite Database
const db = new sqlite3.Database('studygroup.db', (err) => {
  if (err) console.error(err.message);
  console.log('Connected to SQLite database');
});

// Initialize Tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, bio TEXT, profilePicture TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, userId INTEGER, content TEXT, FOREIGN KEY(userId) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, postId INTEGER, userId INTEGER, content TEXT, FOREIGN KEY(postId) REFERENCES posts(id), FOREIGN KEY(userId) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT, description TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_members (groupId INTEGER, userId INTEGER, FOREIGN KEY(groupId) REFERENCES groups(id), FOREIGN KEY(userId) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS group_messages (id INTEGER PRIMARY KEY, groupId INTEGER, fromId INTEGER, content TEXT, FOREIGN KEY(groupId) REFERENCES groups(id), FOREIGN KEY(fromId) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, fromId INTEGER, toId INTEGER, content TEXT, FOREIGN KEY(fromId) REFERENCES users(id), FOREIGN KEY(toId) REFERENCES users(id))`);

  // Add description column if it doesn't exist
  db.run(`ALTER TABLE groups ADD COLUMN description TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
      console.error('Error adding description column:', err.message);
    }
  });
});

// Middleware to check if user is logged in
const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Routes

app.get('/', (req, res) => {
  res.redirect('/login');
});

// Login Page
app.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt:', { username, password });
  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.render('login', { error: 'Database error, try again' });
    }
    if (!user) {
      console.log('User not found or invalid credentials');
      return res.render('login', { error: 'Invalid username or password' });
    }
    console.log('User found:', user);
    req.session.user = user;
    console.log('Session set:', req.session.user);
    res.redirect('/home');
  });
});

// Signup Page
app.get('/signup', (req, res) => {
  res.render('signup', { title: 'Sign Up' });
});

app.post('/signup', (req, res) => {
  const { username, password } = req.body;
  db.run(`INSERT INTO users (username, password, bio, profilePicture) VALUES (?, ?, ?, ?)`, 
    [username, password, '', '/images/user.png'], function(err) {
      if (err) {
        console.error('Signup error:', err.message);
        return res.render('signup', { error: 'Signup failed' });
      }
      req.session.user = { id: this.lastID, username, password, bio: '', profilePicture: 'Default Profile Pic' };
      res.redirect('/home');
    });
});

// Home Page (Posts only, filtered for logged-in user)
app.get('/home', requireLogin, (req, res) => {
  db.all(`SELECT p.*, u.username FROM posts p JOIN users u ON p.userId = u.id WHERE p.userId = ?`, [req.session.user.id], (err, posts) => {
    if (err) console.error(err.message);
    res.render('home', {
      title: 'Home',
      user: req.session.user,
      posts: posts || []
    });
  });
});

app.post('/posts', requireLogin, (req, res) => {
  const { content } = req.body;
  db.run(`INSERT INTO posts (userId, content) VALUES (?, ?)`, [req.session.user.id, content], (err) => {
    if (err) console.error(err.message);
    res.redirect('/home');
  });
});

app.post('/posts/:id/delete', requireLogin, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM posts WHERE id = ? AND userId = ?`, [id, req.session.user.id], (err) => {
    if (err) console.error(err.message);
    res.redirect('/home');
  });
});

app.post('/posts/:id/comments', requireLogin, (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;
  db.run(`INSERT INTO comments (postId, userId, content) VALUES (?, ?, ?)`, [id, req.session.user.id, comment], (err) => {
    if (err) console.error(err.message);
    res.redirect(`/post/${id}`);
  });
});

// Groups Page (Updated to remove add member during creation)
app.get('/groups', requireLogin, (req, res) => {
  db.all(`
    SELECT g.*, GROUP_CONCAT(gm.userId) as members, u.username as creator 
    FROM groups g 
    JOIN group_members gm ON g.id = gm.groupId 
    JOIN users u ON gm.userId = u.id 
    WHERE gm.userId = ? 
    GROUP BY g.id`, [req.session.user.id], (err, groups) => {
    if (err) console.error(err.message);
    res.render('groups', {
      title: 'Groups',
      user: req.session.user,
      groups: groups.map(g => ({ ...g, members: g.members ? g.members.split(',').map(Number) : [] })) || []
    });
  });
});

app.post('/groups', requireLogin, (req, res) => {
  const { name, description } = req.body;
  db.run(`INSERT INTO groups (name, description) VALUES (?, ?)`, [name, description || ''], function(err) {
    if (err) {
      console.error(err.message);
      return res.redirect('/groups');
    }
    const groupId = this.lastID;
    db.run(`INSERT INTO group_members (groupId, userId) VALUES (?, ?)`, [groupId, req.session.user.id], (err) => {
      if (err) console.error(err.message);
      res.redirect('/groups');
    });
  });
});

// Feed Page (All Posts, no comments)
app.get('/feed', requireLogin, (req, res) => {
  db.all(`SELECT p.*, u.username, u.profilePicture FROM posts p JOIN users u ON p.userId = u.id`, (err, posts) => {
    if (err) {
      console.error(err.message);
      posts = [];
    }
    res.render('feed', {
      title: 'Feed',
      user: req.session.user,
      posts: posts || []
    });
  });
});

// Post Detail Page
app.get('/post/:id', requireLogin, (req, res) => {
  const { id } = req.params;
  db.get(`SELECT p.*, u.username, u.profilePicture FROM posts p JOIN users u ON p.userId = u.id WHERE p.id = ?`, [id], (err, post) => {
    if (err || !post) {
      console.error(err ? err.message : 'Post not found');
      return res.redirect('/feed');
    }
    db.all(`SELECT c.*, u.username AS commenter, u.profilePicture AS commenterPicture FROM comments c JOIN users u ON c.userId = u.id WHERE c.postId = ?`, [id], (err, comments) => {
      if (err) {
        console.error(err.message);
        comments = [];
      }
      res.render('post', {
        title: `Post by ${post.username}`,
        user: req.session.user,
        post,
        comments: comments || []
      });
    });
  });
});

// Friends Page (Include profile pictures)
app.get('/friends', requireLogin, (req, res) => {
  db.all(`SELECT id, username, profilePicture FROM users WHERE id != ?`, [req.session.user.id], (err, users) => {
    if (err) console.error(err.message);
    res.render('friends', {
      title: 'Friends',
      user: req.session.user,
      users: users || [],
      searchResults: []
    });
  });
});

app.post('/friends/search', requireLogin, (req, res) => {
  const { searchUsername } = req.body;
  db.all(`SELECT id, username, profilePicture FROM users WHERE username LIKE ? AND id != ?`, [`%${searchUsername}%`, req.session.user.id], (err, searchResults) => {
    if (err) console.error(err.message);
    db.all(`SELECT id, username, profilePicture FROM users WHERE id != ?`, [req.session.user.id], (err, users) => {
      if (err) console.error(err.message);
      res.render('friends', {
        title: 'Friends',
        user: req.session.user,
        users: users || [],
        searchResults: searchResults || []
      });
    });
  });
});

// Profile Page
app.get('/profile', requireLogin, (req, res) => {
  res.render('profile', { title: 'Profile', user: req.session.user });
});

app.post('/profile', requireLogin, (req, res) => {
  const { bio, profilePicture, username } = req.body;
  db.run(`UPDATE users SET bio = ?, profilePicture = ?, username = ? WHERE id = ?`, 
    [bio || req.session.user.bio, profilePicture || req.session.user.profilePicture, username || req.session.user.username, req.session.user.id], (err) => {
      if (err) console.error(err.message);
      req.session.user.bio = bio || req.session.user.bio;
      req.session.user.profilePicture = profilePicture || req.session.user.profilePicture;
      req.session.user.username = username || req.session.user.username;
      res.redirect('/profile');
    });
});

// Messages Page (Include profile pictures)
app.get('/messages', requireLogin, (req, res) => {
  db.all(`SELECT DISTINCT u.id, u.username, u.profilePicture 
          FROM users u 
          JOIN messages m ON (m.fromId = u.id AND m.toId = ?) OR (m.toId = u.id AND m.fromId = ?)
          WHERE u.id != ?`, 
    [req.session.user.id, req.session.user.id, req.session.user.id], (err, contacts) => {
      if (err) console.error(err.message);
      res.render('messages', {
        title: 'Messages',
        user: req.session.user,
        contacts: contacts || []
      });
    });
});

// Conversation Page
app.get('/messages/:userId', requireLogin, (req, res) => {
  const { userId } = req.params;
  db.get(`SELECT id, username FROM users WHERE id = ?`, [userId], (err, recipient) => {
    if (err || !recipient) return res.redirect('/messages');
    db.all(`SELECT m.*, u.username as fromUsername, u.profilePicture as fromPicture 
            FROM messages m 
            JOIN users u ON m.fromId = u.id 
            WHERE (m.fromId = ? AND m.toId = ?) OR (m.fromId = ? AND m.toId = ?)`, 
      [req.session.user.id, userId, userId, req.session.user.id], (err, messages) => {
        if (err) console.error(err.message);
        res.render('conversation', {
          title: `Chat with ${recipient.username}`,
          user: req.session.user,
          recipient,
          messages: messages || []
        });
      });
  });
});

app.post('/messages/:userId', requireLogin, (req, res) => {
  const { userId } = req.params;
  const { content } = req.body;
  db.run(`INSERT INTO messages (fromId, toId, content) VALUES (?, ?, ?)`, [req.session.user.id, userId, content], (err) => {
    if (err) console.error(err.message);
    res.redirect(`/messages/${userId}`);
  });
});

// Group Page (Updated to handle search, add/remove members, and delete group)
app.get('/group/:id', requireLogin, (req, res) => {
  const { id } = req.params;
  db.get(`SELECT g.*, GROUP_CONCAT(gm.userId) as members FROM groups g LEFT JOIN group_members gm ON g.id = gm.groupId WHERE g.id = ? GROUP BY g.id`, [id], (err, group) => {
    if (err || !group) {
      if (err) console.error(err.message);
      return res.redirect('/groups');
    }
    db.all(`SELECT gm.*, u.username as fromUsername FROM group_messages gm JOIN users u ON gm.fromId = u.id WHERE gm.groupId = ?`, [id], (err, messages) => {
      if (err) console.error(err.message);
      db.all(`SELECT u.id, u.username, u.profilePicture FROM group_members gm JOIN users u ON gm.userId = u.id WHERE gm.groupId = ?`, [id], (err, members) => {
        if (err) console.error(err.message);
        res.render('group', {
          title: group.name,
          user: req.session.user,
          group: { ...group, members: group.members ? group.members.split(',').map(Number) : [] },
          messages: messages || [],
          members: members || [],
          searchResults: []
        });
      });
    });
  });
});

app.post('/group/:id/messages', requireLogin, (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  db.run(`INSERT INTO group_messages (groupId, fromId, content) VALUES (?, ?, ?)`, [id, req.session.user.id, content], (err) => {
    if (err) console.error(err.message);
    res.redirect(`/group/${id}`);
  });
});

app.post('/group/:id/search-users', requireLogin, (req, res) => {
  const { id } = req.params;
  const { searchUsername } = req.body;
  db.get(`SELECT g.*, GROUP_CONCAT(gm.userId) as members FROM groups g LEFT JOIN group_members gm ON g.id = gm.groupId WHERE g.id = ? GROUP BY g.id`, [id], (err, group) => {
    if (err || !group) {
      if (err) console.error(err.message);
      return res.redirect('/groups');
    }
    db.all(`SELECT gm.*, u.username as fromUsername FROM group_messages gm JOIN users u ON gm.fromId = u.id WHERE gm.groupId = ?`, [id], (err, messages) => {
      if (err) console.error(err.message);
      db.all(`SELECT u.id, u.username, u.profilePicture FROM group_members gm JOIN users u ON gm.userId = u.id WHERE gm.groupId = ?`, [id], (err, members) => {
        if (err) console.error(err.message);
        db.all(`SELECT id, username, profilePicture FROM users WHERE username LIKE ? AND id NOT IN (SELECT userId FROM group_members WHERE groupId = ?)`, [`%${searchUsername}%`, id], (err, searchResults) => {
          if (err) console.error(err.message);
          res.render('group', {
            title: group.name,
            user: req.session.user,
            group: { ...group, members: group.members ? group.members.split(',').map(Number) : [] },
            messages: messages || [],
            members: members || [],
            searchResults: searchResults || []
          });
        });
      });
    });
  });
});

app.post('/group/:id/add-member/:userId', requireLogin, (req, res) => {
  const { id, userId } = req.params;
  db.run(`INSERT OR IGNORE INTO group_members (groupId, userId) VALUES (?, ?)`, [id, userId], (err) => {
    if (err) console.error(err.message);
    res.redirect(`/group/${id}`);
  });
});

app.post('/group/:id/remove-member/:userId', requireLogin, (req, res) => {
  const { id, userId } = req.params;
  db.run(`DELETE FROM group_members WHERE groupId = ? AND userId = ?`, [id, userId], (err) => {
    if (err) console.error(err.message);
    res.redirect(`/group/${id}`);
  });
});

app.post('/group/:id/delete', requireLogin, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM group_messages WHERE groupId = ?`, [id], (err) => {
    if (err) console.error(err.message);
    db.run(`DELETE FROM group_members WHERE groupId = ?`, [id], (err) => {
      if (err) console.error(err.message);
      db.run(`DELETE FROM groups WHERE id = ?`, [id], (err) => {
        if (err) console.error(err.message);
        res.redirect('/groups');
      });
    });
  });
});

app.post('/group/:id/update', requireLogin, (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  db.run(`UPDATE groups SET name = ?, description = ? WHERE id = ?`, [name, description, id], (err) => {
    if (err) console.error(err.message);
    res.redirect(`/group/${id}`);
  });
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});