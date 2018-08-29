const MongoClient = require('mongodb').MongoClient
    , assert = require('assert');
const utils = require("./utils");
require('dotenv').config();

if (process.env.MONGO_USR && process.env.MONGO_PASS) {
    const user = process.env.MONGO_USR;
    const pass = process.env.MONGO_PASS;
    // Connection URL
    var url = 'mongodb://' + user + ':' + pass + '@ds012678.mlab.com:12678/onlyprofitbot';
}


// Use connect method to connect to the server
function connectMongo(error, cli) {
    MongoClient.connect(url, { useNewUrlParser: true }, function (err, client) {
        if (err) {
            throw err;
            error(err);
        } else {
            cli(client);
        };
    });
}

//save to MongoDB
exports.saveOne = function (data, cname, id) {
    connectMongo(err => { if (err) throw err }, client => {
        var db = client.db("onlyprofitbot");
        var collection = db.collection(cname);

        collection.findOne(id, function (err, result) {
            if (result) {
                //Then save current data to id 1
                //Can't do replacemany :(
                collection.replaceOne({ "_id": 2 }, { "data": result.data },
                    {
                        upsert: true,
                        $currentDate: {
                            lastModified: true,
                        }
                    }, function (e, r) {
                        if (r) { utils.log("Previous " + "\"" + cname + "\"" + " data exists, backup to 2nd index...") }
                        else { throw e };
                    });

                collection.replaceOne({ "_id": 1 }, { data },
                    {
                        upsert: true,
                        $currentDate: {
                            lastModified: true,
                        }
                    }, function (e, r) {
                        if (r) { utils.log("Data saved to first " + "\"" + cname + "\"" + " index!") }
                        else { throw e };
                    })
            } else {
                collection.insertOne({ "_id": 1, data }, {
                    $currentDate: {
                        lastModified: true,
                    }
                }, function (e, r) {
                    if (r) {
                        utils.log("No previous " + "\"" + cname + "\"" + " data detected, Data saved to MongoDB!");
                    } else { throw e };
                });
            }
        });

    })
}

exports.xtendSave = function (data, id, cname) {
    connectMongo(err => { if (err) throw err }, client => {

        var db = client.db("onlyprofitbot");
        var collection = db.collection(cname);

        collection.createIndex({ "expireAt": 1 }, { expireAfterSeconds: 0 })

        collection.insertOne({ _id: id, data }, {
            "expireAt": new Date(utils.addMonth(1)),
            "logEvent": 2,
            "logMessage": "Success!"
        }, (e, r) => {
            if (e) throw e
            else
                utils.log("InsertedOne" + cname)
        })

    })
}

//readfromMongoDB
exports.readOne = function (cname, query) {
    return new Promise((resolve, reject) => {
        connectMongo(err => { if (err) throw err }, client => {

            var db = client.db("onlyprofitbot");
            var collection = db.collection(cname);
            collection.findOne(query, function (e, r) {
                resolve(r);
                reject(e)
            });

        });
    })
}

exports.readMany = function (cname, query, fields) {
    return new Promise((resolve, reject) => {
        connectMongo(err => { if (err) throw err }, client => {

            var db = client.db("onlyprofitbot");
            var collection = db.collection(cname);
            collection.find(query, fields).toArray(function (err, docs) {
                resolve(docs);
                reject(err)
            })

        })
    })
}

exports.updateOne = function (cname, query, fields) {
    return new Promise((resolve, reject) => {
        connectMongo(err => { if (err) throw err }, client => {

            var db = client.db("onlyprofitbot");
            var collection = db.collection(cname);
            collection.updateOne(query, fields, function (err, docs) {
                resolve(docs);
                reject(err)
            })

        })
    })
}
