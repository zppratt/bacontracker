// Import the dependencies
var passport = require('passport');
var winston = require('winston');
var HTTP = require('http-status-codes');
var router = require('express').Router();
var LocalStrategy = require('passport-local').Strategy;
var Issue = require('../models/issue.js');
var Project = require('../models/project.js');
var User = require('../models/user.js');

// *****************************************************************
// * Configure passportjs
// *****************************************************************

// Setup the passport authentication strategy and session serialization
passport.use(new LocalStrategy(
    {
        usernameField: 'form-username',
        passwordField: 'form-password'
    },
    (username, password, done) => {
        User.find({ username: username }, (err, users) => {
            if (err) {
                done(err, false);
            }
            else if (!users || users.length !== 1 || !users[0].authenticate(password)) {
                done(null, false);
            }
            else {
                // Populate the projects
                var usr = users[0];
                usr.populate("projects colabProjects", (err) => {
                    if (err) {
                        done(err, false);
                    }
                    else {
                        done(null, users[0]);
                    }
                });
            }
        });
    })
);

passport.serializeUser((user, done) => {
    done(null, user._id);
});

passport.deserializeUser((id, done) => {
    User.find({ _id: id }, (err, users) => {
        if (err || users.length !== 1) {
            return done(err, false);
        }
        else {
            // Populate the projects
            var usr = users[0];
            usr.populate("projects colabProjects", (err) => {
                if (err) {
                    done(err, false);
                }
                else {
                    done(null, users[0]);
                }
            });
        }
    });
});

// *****************************************************************
// * Open the routes
// *****************************************************************

router.post('/login', (req, res) => {
    winston.debug("Inside /api/login");

    // Perform the login. TODO: This is weird, may need to review this...
    passport.authenticate('local', (err, user) => {
        if (err) {
            handleError(err, HTTP.INTERNAL_SERVER_ERROR, res);
        }
        else if (!user) {
            handleError(new Error("Incorrect username or password"), HTTP.UNAUTHORIZED, res);
        }
        else {
            // Serialize the user to the cookie
            req.login(user, (err) => {
                if (err) {
                    handleError(err, HTTP.INTERNAL_SERVER_ERROR, res);
                }

                winston.debug(user.username, "has just logged in.");

                var resData = {
                    username: user.username,
                    projects: user.projects,
                    colabProjects: user.colabProjects
                }

                sendResponse(resData, HTTP.OK, res);
            })
        }
    })(req, res);
});

router.get('/logout', (req, res) => {
    winston.debug("Inside /api/logout");

    req.logout();

    sendResponse(null, HTTP.OK, res);
});

router.post('/signup', (req, res) => {
    winston.debug("Inside /api/signup");

    // Ensure the data is correct
    if (req.body["form-password"] !== req.body["form-password2"] || !req.body["form-username"]) {
        handleError(new Error("Passwords do not match"), HTTP.BAD_REQUEST, res);
    }

    var user = new User({
        username: req.body["form-username"],
        password: req.body["form-password"]
    });

    // Save the new user
    user.save((err) => {
        if (err) {
            handleError(err, 500, res);
        }
        else {
            winston.debug("User created", user.username);

            // Serialize the user to the cookie
            req.login(user, (err) => {
                if (err) {
                    handleError(err, HTTP.INTERNAL_SERVER_ERROR, res);
                }

                winston.debug(user.username, "has just logged in.");
                var resData = {
                    username: user.username,
                    projects: user.projects,
                    colabProjects: user.colabProjects
                };

                // sendResponse(resData, HTTP.OK, res); TODO: Make the front end redirect
                res.redirect("/projects.html");
            });
        }
    })
});

router.get('/whoami', (req, res) => {
    winston.debug("Inside /api/whoami");

    if (!req.user) {
        handleError(new Error("User unauthenticated"), HTTP.UNAUTHORIZED, res)
    }
    else {
        var resData = {
            username: req.user.username,
            projects: req.user.projects,
            colabProjects: req.user.colabProjects
        }

        sendResponse(resData, HTTP.OK, res)
    }
});

router.get('/projects', (req, res) => {
    winston.debug("Inside GET /api/projects");

    if (!req.user) {
        handleError(new Error("User unauthenticated"), HTTP.UNAUTHORIZED, res);
    }
    else if (!req.query || !req.query.pname) {
        handleError(new Error("Bad request"), HTTP.BAD_REQUEST, res);
    }
    else {
        // Check if the user owns the project
        var reqProj = req.user.projects.find((project) => {
            return project.name === req.query.pname
        });

        // If not found check if it's a colab project
        if (!reqProj) {
            reqProj = req.user.colabProjects.find((project) => {
                return project.name === req.query.pname
            });
        }

        if (reqProj) {
            sendResponse(reqProj, HTTP.OK, res);
        }
        else {
            sendResponse(null, HTTP.NOT_FOUND, res);
        }
    }
});

router.post('/projects', (req, res) => {
    winston.debug("Inside POST /api/projects");

    if (!req.user) {
        handleError(new Error("User unauthenticated"), HTTP.UNAUTHORIZED, res);
    }
    else if (!req.body || !req.body.pname || !req.body.projDescription) {
        handleError(new Error("Bad request"), HTTP.BAD_REQUEST, res);
    }
    else {
        // Make new project
        var newProj = new Project({
            name: req.body.pname,
            description: req.body.projDescription,
            issues: []
        });

        // Save new project
        newProj.save((err) => {
            if (err) {
                handleError(new Error("Database save error"), HTTP.INTERNAL_SERVER_ERROR, res);
            }
            else {
                // Save the new project to the user
                req.user.projects.push(newProj);
                req.user.save((err) => {
                    if (err) {
                        handleError(new Error("Database save error"), HTTP.INTERNAL_SERVER_ERROR, res);
                    }
                    else {

                        // Send success
                        sendResponse(newProj, HTTP.OK, res);
                    }
                });
            }
        });
    }
});

router.put('/projects', (req, res) => {
    winston.debug("Inside PUT /api/projects");

    if (!req.user) {
        handleError(new Error("User unauthenticated"), HTTP.UNAUTHORIZED, res);
    }
    else if (!req.query || !req.query.pname || !req.body) {
        handleError(new Error("Bad request"), HTTP.BAD_REQUEST, res);
    }
    else {
        // Check if the project is on the user's object
        var reqProj = req.user.projects.find((project) => {
            return project.name === req.query.pname
        });
        if (!reqProj) {
            handleError(new Error("Bad request"), HTTP.BAD_REQUEST, res);
        }
        else {

            reqProj.name = req.body.pname ? req.body.pname : proj.name;
            reqProj.description = req.body.projDescription ? req.body.projDescription : proj.description;

            reqProj.save((err) => {
                if (err) {
                    handleError(new Error("Database save error"), HTTP.INTERNAL_SERVER_ERROR, res);
                }
                else {
                    sendResponse(reqProj, HTTP.OK, res);
                }
            });
        }
    }
});

router.delete('/projects', (req, res) => {
    winston.debug("Inside DELETE /api/projects");

    if (!req.user) {
        handleError(new Error("User unauthenticated"), HTTP.UNAUTHORIZED, res);
    }
    else if (!req.query || !req.query.pname) {
        handleError(new Error("Bad request"), HTTP.BAD_REQUEST, res);
    }
    else {
        // Check if the project is on the user's object
        var reqProj = req.user.projects.find((project) => {
            return project.name === req.query.pname
        });
        if (!reqProj) {
            handleError(new Error("Bad request"), HTTP.BAD_REQUEST, res);
        }
        else {
            // Delete the project from all users
            User.find({ $or: [{ colabProjects: reqProj }, { projects: reqProj }] }, (err, users) => {
                if (err) {
                    handleError(new Error("Database read error"), HTTP.INTERNAL_SERVER_ERROR, res);
                }
                users.forEach((usr) => {
                    usr.projects.splice(req.user.projects.indexOf(reqProj), 1);
                    usr.colabProjects.splice(req.user.projects.indexOf(reqProj), 1);
                    usr.save();
                });

                // Delete the project
                reqProj.remove();

                // Send success
                sendResponse(reqProj, HTTP.OK, res);
            });
        }
    }
});

// router.post('/issues', postIssue);
// router.put('/issues/:pname/:issueNum', putIssue);
// router.del('/issues/:pname/:issueNum', delIssue);

// router.get('/users/:userID', getUser);
// router.post('/users', postUser);
// router.put('/users/:userID', putUser);
// router.del('/users/:userID', delUser);

// *****************************************************************
// * Define helper functions
// *****************************************************************

/**
 * This function is a helper for handling errors.
 * @param error The error to be handled
 * @param status The HTTP status to be sent
 * @param res The express response object
 */
function handleError(error, status, res) {
    switch (status) {
        case HTTP.BAD_REQUEST:
            winston.warn("Received a bad request:", error.message);
            break;
        case HTTP.UNAUTHORIZED:
            winston.warn("Unauthorized access attempted:", error.message);
            break;
        case HTTP.INTERNAL_SERVER_ERROR:
            winston.error("Something broke with the server:", error.message);
            break;
        default:
            winston.error("Something unexpected happened:", error.message);
    }

    sendResponse(null, status, res);
};

/**
 * This function is a helper for sending a JSON response.
 * @param data The data to be sent
 * @param status The HTTP status code to be sent
 * @param res The express response object
 */
function sendResponse(data, status, res) {
    winston.info("Sending response with status:", status);
    if (data) {
        res.status(status).send(data);
    }
    else {
        res.status(status).send(HTTP.getStatusText(status));
    }
};

module.exports = router;
