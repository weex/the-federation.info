var express = require('express'),
    https = require('https'),
    util = require('util'),
    expressValidator = require('express-validator'),
    scheduler = require('node-schedule'),
    db = require('./database');
var app = express();

app.engine('jade', require('jade').renderFile);
app.set('title', 'Diaspora* Hub');
app.use(expressValidator([]));

app.get('/', function(req, res) {
    var data = db.Pod.all(function(err, pods) {
        console.log(pods);
        var data = {
            total_users: [],
            active_users: [],
            local_posts: [],
        };
        for (var p=0; p<pods.length; p++) {
            data.total_users.push({ name: pods[p].name, data: [] });
            data.active_users.push({ name: pods[p].name, data: [] });
            data.local_posts.push({ name: pods[p].name, data: [] });
            var pp = p;
            pods[p].getStats(function(err, stats) {
                for (var i=0; i<stats.length; i++) {
                    data.total_users[pp].data.push({ x: i, y: stats[i].total_users });
                    data.active_users[pp].data.push({ x: i, y: stats[i].active_users });
                    data.local_posts[pp].data.push({ x: i, y: stats[i].local_posts });
                }
                res.render('index.jade', { data: data });
            });
            
        }
        
    });
});

function callPod(podhost) {
    var options = {
        host: podhost,
        port: 443,
        path: '/statistics.json',
        method: 'GET'
    };
    var request = https.request(options, function(res) {
        console.log('STATUS: ' + res.statusCode);
        console.log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (data) {
            console.log('BODY: ' + data);
            try {
                data = JSON.parse(data);
                if (typeof data.version !== 'undefined') {
                    db.Pod.exists({ host: podhost }, function (err, exists) {
                        if (! exists) {
                            // Insert
                            db.Pod.create({
                                name: data.name,
                                host: podhost,
                                version: data.version,
                                registrations_open: data.registrations_open,
                            }, function (err, items) {
                                if (err)
                                    console.log("Database error when inserting pod: "+err);
                                else
                                    items.logStats(data);
                            });
                        } else {
                            // Check for changes
                            db.Pod.find({ host: podhost }, function(err, pods) {
                                pod = pods[0];
                                if (pod.needsUpdate(data.name, data.version, data.registrations_open)) {
                                    pod.name = data.name;
                                    pod.version = data.version;
                                    pod.registrations_open = data.registrations_open;
                                    pod.save(function(err) {
                                        if (err) console.log(err);
                                    });
                                };
                                pod.logStats(data);
                            });
                        }
                    });
                } else {
                    throw err;
                }
            } catch (err) {
                console.log('not a valid statistics json');
            }
        });
    });
    request.end();
    request.on('error', function(e) {
        console.error(e);
    });
}

app.get('/register/:podhost', function(req, res) {
    console.log(req.ip);
    
    req.assert('podhost', 'Invalid pod url').isUrl().len(1, 100);
    var errors = req.validationErrors();
    if (errors) {
        res.send('There have been validation errors: ' + util.inspect(errors), 400);
        return;
    }

    callPod(req.params.podhost);
    
    res.type('text/plain');
    res.send('register received');
});

// Scheduling
var updater = scheduler.scheduleJob('7 0 * * *', function() {
    console.log('Calling pods for an update..');
    
    db.Pod.find({}, function(err, pods) {
        for (var i=0; i<pods.length; i++) {
            callPod(pods[i].host);
        }
    });
});

app.listen(process.env.PORT || 4730);
