"use strict";

const {app, BrowserWindow, ipcMain} = require("electron");
const path = require("path");
var sqlite3 = require('sqlite3').verbose();
const settings = require('config.json')('settings.json');
var file = settings.file;
var db = new sqlite3.Database(file);
var domtoimage = require('dom-to-image');
var bodyParser = require('body-parser');
var cors = require('cors');
const sdk = require('api')('@checkbook-docs/v3.1#gya1ukwcfw4t7');
var https = require('follow-redirects').https;
var fs = require('fs');

let mainWindow;

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: "assets/logo.png",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile("views/index.html");
  mainWindow.on("closed", function () {
    mainWindow = null;
  });
  mainWindow.setMenu(null);
}

app.on("ready", createWindow);
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", function () {
  if (mainWindow === null) createWindow();
});
ipcMain.on("error", function(evt, data){
  mainWindow.webContents.send("error", "NOT IMPLEMENTED");
});

// IPC Operations
ipcMain.on('getBankAccounts', function(params){
  getBankAccounts(
    function(accounts){
      mainWindow.webContents.send("getBankAccounts", accounts);
    }, 
    function(error){
      mainWindow.webContents.send("error", error);
    });  
});

ipcMain.on('importBankAccounts',function(channel, params){
  var env = settings['checkbook.io']['environment'];
  var auth = settings['checkbook.io'][env].authorization;
  var hostname = settings['checkbook.io'][env].hostname;
  var options = {
    'method': 'GET',
    'hostname': hostname,
    'path': '/v3/bank',
    'headers': {
      'Authorization': auth
    },
    'maxRedirects': 20
  };
  
  var req = https.request(options, function (res) {
    var chunks = [];
  
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
  
    res.on("end", function (chunk) {
      var body = Buffer.concat(chunks);
      var json = body.toString();
      console.log(json);
      var result = JSON.parse(json);
      result.banks.forEach(function(bank){
        console.log(bank);
        addBankAccount(bank.routing, bank.account, bank.name, "", "", "", "https://sandbox.app.checkbook.io/account/settings/accounts", 100, 0, bank.id,
          function(lastID, changes){
            mainWindow.webContents.send("importBankAccounts", [lastID,changes]);
          }, 
          function(error){
            mainWindow.webContents.send("error", error);
          });        
      });
    });
  
    res.on("error", function (error) {
      mainWindow.webContents.send("error", error);
    });
  });
  
  req.end();
});

ipcMain.on('newRecipient', function(channel, params){
  addRecipient(params, 
    function(lastID, changes){
      mainWindow.webContents.send("newRecipient", [lastID, changes]);
    }, 
    function(error){
      mainWindow.webContents.send("error", error);
    });
});

ipcMain.on('getRecipients', function(channel, params){
  getRecipients(
    function(rows){
      mainWindow.webContents.send("getRecipients", rows);
    }, 
    function(error){
      mainWindow.webContents.send("error", error);
    });
});
ipcMain.on('createPhysicalCheck', function(channel, params){
  var env = settings['checkbook.io']['environment'];
  var auth = settings['checkbook.io'][env].authorization;
  var hostname = settings['checkbook.io'][env].hostname;
  var options = {
    'method': 'POST',
    'hostname': hostname,
    'path': '/v3/bank',
    'headers': {
      'Authorization': auth,
      'Content-Type': 'application/json'
    },
    'maxRedirects': 20
  };
  
  var req = https.request(options, function (res) {
    var chunks = [];
  
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
  
    res.on("end", function (chunk) {
      var body = Buffer.concat(chunks);
      console.log(body.toString());
      addCheckRegisterEntry(params.id, params.date, params.name, params.amount, params.description, params.image, body.toString(), 
        function(lastID, changes){
          mainWindow.webContents.send("createPhysicalCheck", body.toString());
        }, 
        function(error){
          mainWindow.webContents.send("error", error);
        });
    });
  
    res.on("error", function (error) {
      mainWindow.webContents.send("error", error);
    });
  });
  
  var postData =  JSON.stringify({
    "recipient": {
      "line_1": params.line_1,
      "line_2": params.line_2,
      "city": params.city,
      "state": params.state,
      "zip": params.zip,
      "country": params.country
    },
    "name": params.name,
    "amount": params.amount,
    "description": params.description,
    "number": params.number,
    "account": params.account,
    "routing": params.routing,
    "type": params.type
  });
  req.write(postData);
  
  req.end();  
});
ipcMain.on('newCheckRegisterEntry', function(channel, params){
  addCheckRegisterEntry(params.id, params.date, params.name, params.amount, params.description, params.image, JSON.stringify({error: "not permitted"}), 
  function(lastID, changes){
    mainWindow.webContents.send("newCheckRegisterEntry", [lastID, changes]);
  }, 
  function(error){
    mainWindow.webContents.send("error", error);
  });
});
ipcMain.on('getRegister', function(channel, params){
  getCheckRegisterEntries(params.account, 
    function(rows){
      mainWindow.webContents.send('getRegister',rows);
    }, 
    function(error){
      mainWindow.webContents.send("error", error);
    });
});

/**
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 * Bank Account Operations
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 */
/**
 * addBankAccount
 * 
 * @param {*} rtn 
 * @param {*} acctnum 
 * @param {*} name 
 * @param {*} address 
 * @param {*} csz 
 * @param {*} phone 
 * @param {*} url 
 * @param {*} nextnumber 
 * @param {*} opening_balance 
 * @param {*} success_callback 
 * @param {*} error_callback 
 */
function addBankAccount(rtn, acctnum, name, address, csz, phone, url, nextnumber, opening_balance, checkbookid_id, success_callback, error_callback) {
  var sql = `INSERT INTO accounts (number, routing, bankname, bankaddress, bankcsz, bankurl, bankphone, checkbookio_id) VALUES ($acctnum,$rtn,$name,$address,$csz,$url,$phone,$cbid)`;
  var params = {
    $acctnum: acctnum,
    $rtn: rtn,
    $name: name,
    $address: address,
    $csz: csz,
    $url: url,
    $phone: phone,
    $cbid: checkbookid_id
  };
  db_insert(sql, params, 
    function(lastID, changes){
      sql = `INSERT INTO account_meta (account, nextnumber, balance) VALUES ($id, $nextnumber, $opening_balance)`;
      params = {
        $id: lastID,
        $nextnumber: nextnumber,
        $opening_balance: opening_balance
      };
      db_insert(sql, params, 
        function(lastID, changes){
          success_callback(lastID, changes);
        }, error_callback);
    }, error_callback);
}

/**
 * editBankAccount
 * 
 * @param {*} ref 
 * @param {*} rtn 
 * @param {*} acctnum 
 * @param {*} name 
 * @param {*} address 
 * @param {*} csz 
 * @param {*} phone 
 * @param {*} url 
 * @param {*} nextnumber 
 * @param {*} opening_balance 
 * @param {*} success_callback 
 * @param {*} error_callback 
 */
function editBankAccount(ref, rtn, acctnum, name, address, csz, phone, url, success_callback, error_callback) {
  var sql = `UPDATE accounts SET number=$acctnum, routing=$rtn, bankname=$name, bankaddress=$address, bankcsz=$csz, bankurl=$url, bankphone=$phone WHERE id=$ref`;
  var params = {
    $ref: ref,
    $acctnum: acctnum,
    $rtn: rtn,
    $name: name,
    $address: address,
    $csz: csz,
    $url: url,
    $phone: phone
  };
  db_update(sql, params, 
    function(lastID, changes){
      success_callback(lastID, changes);
    }, error_callback);
}
function backupBankAccount(ref, success_callback, error_callback) {
  var sql = `SELECT * FROM accounts a JOIN checkregister r ON a.id=r.account WHERE account=${ref}`;
  db_query(sql, success_callback, error_callback);
}
function removeBankAccount(ref, success_callback, error_callback) {
  var sql = `DELETE FROM accounts WHERE id=${ref}`;
  db_query(sql, success_callback, error_callback);
}
function getBankAccounts(success_callback, error_callback) {
  var sql = "SELECT a.*,c.nextnumber,c.balance FROM accounts a JOIN account_meta c ON a.id=c.account";
  db_query(sql, success_callback, error_callback);
}
function getBankAccount(ref, success_callback, error_callback) {
  var sql = `SELECT * FROM accounts WHERE id=${ref}`;
  db_query(sql, success_callback, error_callback);
}
function getBalance(ref, success_callback, error_callback) {
  var sql = `SELECT balance FROM account_meta WHERE account=${ref}`;
  db_query(sql, success_callback, error_callback);
}
function updateBalance(ref, amount, success_callback, error_callback) {
  //var sql = `UPDATE account_meta SET balance=(SELECT IIF(SUM(r.amount)>0,m.balance - SUM(r.amount),m.balance) AS balance FROM checkregister r JOIN account_meta m ON r.account=m.account WHERE m.account=${ref}) WHERE account=${ref}`;
  var sql = `UPDATE account_meta SET balance=$balance WHERE account=$account`;
  var params = {
    $balance: amount,
    $account: ref
  };
  db_update(sql, params, success_callback, error_callback);
}
function incrementCheckNumber(ref, success_callback, error_callback) {
  var sql = `UPDATE account_meta SET nextnumber=nextnumber + 1 WHERE account=$id`;
  var params = {
    $id: ref
  };
  db_update(sql,params,success_callback,error_callback);
}

/**
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 * Check Register Operations
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 */
function addCheckRegisterEntry(ref, date, payee, amount, memo, image, checkbookio, success_callback, error_callback) {
  var sql = `INSERT INTO checkregister (date, payee, amount, memo, image, account, checkbookio) VALUES ($date, $payee, $amount, $memo, $image, $account, $checkbookio)`;
  var params = {
    $date: date,
    $payee: payee,
    $amount: amount,
    $memo: memo,
    $image: image,
    $account: ref,
    $checkbookio: checkbookio
  };
  db_insert(sql, params, 
    function(lastID, changes){
      incrementCheckNumber(ref, success_callback, error_callback);
    }, error_callback);
}

function getCheckRegisterEntries(ref, success_callback, error_callback) {
  var sql = 'SELECT * FROM checkregister ORDER BY no';
  if (ref > 0) {
    sql = `SELECT * FROM checkregister WHERE account=${ref} ORDER BY no`;
  }
  db_query(sql, success_callback, error_callback);
}

function getCheckRegisterEntriesByRange(ref, from, to, success_callback, error_callback) {
  var sql = `SELECT * FROM checkregister WHERE account=${ref} AND date BETWEEN '${from}' AND '${to}' ORDER BY no`;
  console.log(sql);
  db_query(sql, success_callback, error_callback);
}

function purgeCheckRegisterEntries(ref, success_callback, error_callback) {
  var sql = `DELETE FROM checkregister WHERE account=${ref}`;
  db_query(sql, success_callback, error_callback);
}

/**
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 * Recipient Operations
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 */
function addRecipient(params, success_callback, error_callback) {
  var sql = `INSERT INTO recipients (name,line_1,line_2,city,state,zip,country) VALUES ($name,$line_1,$line_2,$city,$state,$zip,$country)`;
  db_insert(sql, params, 
    function(lastID, changes){
      success_callback(lastID, changes);
    }, error_callback);
}

function getRecipients(success_callback, error_callback) {
  var sql = 'SELECT * FROM recipients';
  db_query(sql,success_callback, error_callback);
}

function updateRecipient(params, success_callback, error_callback) {
  var sql = `UPDATE recipients SET name=$name, line_1=$line_1, line2=$line_2, city=$city, state=$state, zip=$zip, country=$country WHERE id=$id`;
  db_update(sql,success_callback, error_callback);
}

function purgeRecipient(ref, success_callback, error_callback) {
  var sql = `DELETE FROM recipients WHERE id=${ref}`;
  db_query(sql,success_callback, error_callback);
}

/**
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 * Database Helper Routines
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 */

// DB Query
function db_query(sql, success_callback, error_callback) {
  db.all(sql, function(err, rows){
    if (err) {
      error_callback(err);
    } else {
      success_callback(rows);
    }
  });
}

function db_insert(sql, params, success_callback, error_callback) {
  db.run(sql, params, 
    function(error){
      if (error) {
        error.cmd = "db_insert";
        error_callback(error);
      } else {
        success_callback(this.lastID,this.changes);
      }
    });
}

function db_update(sql, params, success_callback, error_callback) {
  db.run(sql, params, 
    function(error){
      if (error) {
        error.cmd = "db_update";
        error_callback(error);
      } else {
        success_callback(this.lastID,this.changes);
      }
    });
}


/**
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 *  Checkbook API Route Implementations
 * ---------------------------------------------------------------------------------------------------------------------------------------------------------------
 */ 
var express = require('express');
var api = express();
api.use(cors()); // enable cors
api.use(bodyParser.json()); // support json encoded bodies
api.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

/**
 * Bank
 * - addBankAccount
 * - editBankAccount
 * - backupBankAccount
 * - removeBankAccount
 * - getBankAccounts
 * - getBankAccount
 * - getBalance
 */
/**
 * @api {post} /account Add a new bank account
 * @apiBody {String} rtn Bank routing number
 * @apiBody {String} account Bank account number
 * @apiBody {String} address Bank mailing address
 * @apiBody {String} csz Bank city, state and zip code
 * @apiBody {String} phone Bank phone number
 * @apiBody {String} url Bank account access URL
 * @apiBody {Number} next The next available check number
 * @apiBody {Number} balance The current balance
 * @apiVersion 1.0.0
 * @apiName addBankAccount
 * @apiGroup Bank
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "status": "success",
 *       "lastID": 1,
 *       "changes": 1
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request POST 'http://localhost:3000/account/add' \
 *        --header 'Content-Type: application/x-www-form-urlencoded' \
 *        --data-urlencode 'rtn=378674909' \
 *        --data-urlencode 'account=5099784820831' \
 *        --data-urlencode 'name=RedeeCash Bank' \
 *        --data-urlencode 'address=PO Box 143814' \
 *        --data-urlencode 'csz=Gainesville, FL 326144-2814' \
 *        --data-urlencode 'phone=212-879-0758' \
 *        --data-urlencode 'url=https://bank.redeecash.com' \
 *        --data-urlencode 'next=1010' \
 *        --data-urlencode 'balance=1000.00'
 */
 api.post('/account', function(req, res){
  try {
    addBankAccount(req.body.rtn, req.body.account, req.body.name, req.body.address, req.body.csz, req.body.phone, req.body.url, req.body.next, req.body.balance, '',
      function(lastID, changes){
        res.json({status: 'success', lastID: lastID, changes: changes});
      }, 
      function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {put} /account/:id Edit/Update an existing bank account
 * @apiParam {Number} id Bank reference ID
 * @apiBody {String} rtn Bank routing number
 * @apiBody {String} account Bank account number
 * @apiBody {String} address Bank mailing address
 * @apiBody {String} csz Bank city, state and zip code
 * @apiBody {String} phone Bank phone number
 * @apiBody {String} url Bank account access URL
 * @apiVersion 1.0.0
 * @apiName editBankAccount
 * @apiGroup Bank
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request PUT 'http://localhost:3000/account/2' \
 *        --header 'Content-Type: application/x-www-form-urlencoded' \
 *        --data-urlencode 'rtn=378674909' \
 *        --data-urlencode 'account=5099784820831' \
 *        --data-urlencode 'name=RedeeCash Bank' \
 *        --data-urlencode 'address=PO Box 142814' \
 *        --data-urlencode 'csz=Gainesville, FL 32614-2814' \
 *        --data-urlencode 'phone=212-879-0758' \
 *        --data-urlencode 'url=https://bank.redeecash.com' 
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "lastID": 0,
 *        "changes": 1
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.put('/account/:id', function(req, res){
  try {
    editBankAccount(req.params.id, req.body.rtn, req.body.acctnum, req.body.name, req.body.address, req.body.csz, req.body.phone, req.body.url, 
      function(lastID, changes){
        res.json({status: 'success', lastID: lastID, changes: changes});
      }, 
      function(){
        res.json({status: 'error', message: error});
      }
    );
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {post} /account/backup/:id Backup an existing bank account
 * @apiParam {Number} id Bank reference ID
 * @apiBody {String} filename Full path of the location for the backup file
 * @apiVersion 1.0.0
 * @apiName backupBankAccount
 * @apiGroup Bank
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request POST 'http://localhost:3000/account/backup/2' \
 *        --header 'Content-Type: application/x-www-form-urlencoded' \
 *        --data-urlencode 'filename=g:/backup.bak'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "data": [
 *          {
 *             "id": 2,
 *             "number": null,
 *             "routing": "378674909",
 *             "bankname": "RedeeCash Bank",
 *             "bankaddress": "PO Box 142814",
 *             "bankcsz": "Gainesville, FL 32614-2814",
 *             "bankurl": "https://bank.redeecash.com",
 *             "bankphone": "212-879-0758",
 *             "checkbookio_id": "",
 *             "no": 2,
 *             "date": "2022-01-15",
 *             "payee": "PressPage Entertainment Inc",
 *             "amount": 100,
 *             "memo": "Test",
 *             "image": "",
 *             "account": 2,
 *             "checkbookio": "{\"error\":\"not permitted\"}"
 *          },
 *        ],
 *        "filename": "g:/backup.bak"
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.post('/account/backup/:id', function(req, res){
  try {
    backupBankAccount(req.params.id, 
      function(rows){
        var errors = [], storage = [];
        rows.forEach(function(lineItem){
          fs.appendFile(req.body.filename, JSON.stringify(lineItem), function(err){
            if (err) {
              errors.push(err);
            }
          });
        });
        if (errors.length > 0) {
          res.json({status: 'error', message: errors});
        } else {
          res.json({status: 'success', data: rows, filename: req.body.filename});
        }
      }, function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {delete} /account/:id Delete/Purge an existing bank
 * @apiDescription WARNING: the check register items become orphans after deleting the bank account
 * @apiParam {Number} id Bank reference ID
 * @apiVersion 1.0.0
 * @apiName deleteBankAccount
 * @apiGroup Bank
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request DELETE 'http://localhost:3000/account/3'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "status": "success",
 *       "acount": 0
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.delete('/account/:id', function(req, res){
  try {
    removeBankAccount(req.params.id, 
      function(rows){
        res.json({status: 'success', account: rows});
      }, 
      function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {get} /accounts Retrive a list of all bank accounts
 * @apiVersion 1.0.0
 * @apiName getAllBankAccounts
 * @apiGroup Bank
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request GET 'http://localhost:3000/accounts'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "status": "success",
 *       "accounts": [
 *                      {
 *                        "id": 2,
 *                        "number": "5099784820831",
 *                        "routing": "378674909",
 *                        "bankname": "RedeeCash Bank",
 *                        "bankaddress": "PO Box 142814",
 *                        "bankcsz": "Gainesville, FL 32614-2814",
 *                        "bankurl": "https://bank.redeecash.com",
 *                        "bankphone": "212-879-0758",
 *                        "checkbookio_id": "",
 *                        "nextnumber": 1010,
 *                        "balance": 1000
 *                      }
 *                  ]
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.get('/accounts', function(req, res){
  try {
    getBankAccounts(
      function(accounts){
        res.json({status: 'success', accounts: accounts});
      }, 
      function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {get} /account/:id Retrieve a single bank account
 * @apiParam {Number} id Bank reference ID
 * @apiVersion 1.0.0
 * @apiName getBankSingleBankAccount
 * @apiGroup Bank
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request GET 'http://localhost:3000/account/2'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "status": "success",
 *       "account": [
 *             {
 *                "id": 2,
 *                "number": "5099784820831",
 *                "routing": "378674909",
 *                "bankname": "RedeeCash Bank",
 *                "bankaddress": "PO Box 142814",
 *                "bankcsz": "Gainesville, FL 32607",
 *                "bankurl": "https://bank.redeecash.com",
 *                "bankphone": "212-879-0758",
 *                "checkbookio_id": ""
 *              }
 *         ]
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.get('/account/:id', function(req, res){
  try {
    getBankAccount(req.params.id, 
      function(rows){
        res.json({status: 'success', account: rows});
      }, 
      function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {get} /account/balance/:id Get the balance for a bank account
 * @apiParam {Number} id Bank reference ID
 * @apiVersion 1.0.0
 * @apiName getBalance
 * @apiGroup Bank
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request GET 'http://localhost:3000/account/balance/2'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "balance": 1000
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.get('/account/balance/:id', function(req, res){
  try {
    getBalance(req.params.id, 
      function(result){
        res.json({status: 'success', balance: result[0].balance});
      }, 
      function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {put} /account/balance/:id,:amount Update the balance for a bank account
 * @apiParam {Number} id Bank reference ID
 * @apiParam {Number} amount The new balance (overwrites existing balance)
 * @apiVersion 1.0.0
 * @apiName updateBalance
 * @apiGroup Bank
 * @apiExample {curl} Example usage:
 *    curl --silent --location --request PUT 'http://localhost:3000/account/balance/2,2500.53'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *       "status": "success",
 *       "lastID": 0,
 *       "changes": 1
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.put('/account/balance/:id,:amount', function(req, res){
  try {
    updateBalance(req.params.id,req.params.amount, 
      function(lastID,changes){
        res.json({status: 'success', lastID: lastID, changes: changes});
      }, 
      function(error){
        res.json({status: 'error', message: error});
      });
  } catch (error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * Recipients
 * - getRecipients
 * - addRecipient
 * - updateRecipient
 * - deleteRecipient
 */
/**
 * @api {get} /recipients Get a list of all recipients/payees
 * @apiVersion 1.0.0
 * @apiName getRecipients
 * @apiGroup Payee
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request GET 'http://localhost:3000/recipients'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "recipients": [
 *          {
 *            "id": 2,
 *            "name": "PressPage Entertainment Inc",
 *            "line_1": "PO Box 142814",
 *            "line_2": "",
 *            "city": "Gainesville",
 *            "state": "FL",
 *            "zip": "32614-2814",
 *            "country": "US"
 *          }
 *        ]
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.get('/recipients', function(req, res){
  getRecipients(
    function(rows){
      res.json({status: 'success', recipients: rows});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});
/**
 * @api {post} /recipient Add a new recipient/payee
 * @apiVersion 1.0.0
 * @apiBody {Object} params The payee/recipient 
 * @apiBody {String} params.$name The payee name
 * @apiBody {String} params.$line_1 The payee address
 * @apiBody {String} params.$line_2 The continuation of the payee address
 * @apiBody {String} params.$city The payee city
 * @apiBody {String} params.$state The payee state
 * @apiBody {String} params.$zip The payee zip code
 * @apiBody {String} params.$country The payee country
 * @apiParamExample {json} Params-Example:
 *     "params": {
 *       "$name": "John Doe",
 *       "$line_1": "10 Main Street",
 *       "$line_2": "Apt 1",
 *       "$city": "New York",
 *       "$state": "NY",
 *       "$zip": "10001",
 *       "$country": "US"
 *     }
 * @apiName addRecipient
 * @apiGroup Payee
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request POST 'http://localhost:3000/recipient' \
 *        --header 'Content-Type: application/json' \
 *        --data-raw '{
 *          "params": {
 *            "$name": "PressPage Entertainment Inc",
 *            "$line_1": "PO Box 142814",
 *            "$line_2": "",
 *            "$city": "Gainesville",
 *            "$state": "FL",
 *            "$zip": "32614-2814",
 *            "$country": "US"
 *        }
 *     }'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "lastID": 2,
 *        "changes": 1
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.post('/recipient', function(req, res){
  addRecipient(req.body.params, 
    function(lastID, changes){
      res.json({status: 'success', lastID: lastID, changes: changes});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});
/**
 * @api {put} /recipient Update an existing recipient/payee
 * @apiBody {Object} params The payee/recipient 
 * @apiBody {String} params.$name The payee name
 * @apiBody {String} params.$line_1 The payee address
 * @apiBody {String} params.$line_2 The continuation of the payee address
 * @apiBody {String} params.$city The payee city
 * @apiBody {String} params.$state The payee state
 * @apiBody {String} params.$zip The payee zip code
 * @apiBody {String} params.$country The payee country
 * @apiParamExample {json} Params-Example:
 *     "params": {
 *       "$name": "John Doe",
 *       "$line_1": "10 Main Street",
 *       "$line_2": "Apt 1",
 *       "$city": "New York",
 *       "$state": "NY",
 *       "$zip": "10001",
 *       "$country": "US"
 *     }
 * @apiVersion 1.0.0
 * @apiName updatePayee
 * @apiGroup Payee
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request PUT 'http://localhost:3000/recipient' \
 *        --header 'Content-Type: application/json' \
 *        --data-raw '{
 *            "params": {
 *              "$id": 1,
 *              "$name": "PressPage Entertainment Inc",
 *              "$line_1": "PO Box 142814",
 *              "$line_2": "",
 *              "$city": "Gainesville",
 *              "$state": "FL",
 *              "$zip": "32614-2814",
 *              "$country": "US"
 *         }
 *      }'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "lastID": 2,
 *        "changes": 1
 *      }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.put('/recipient', function(req, res){
  updateRecipient(req.body.params, 
    function(lastID, changes){
      res.json({status: 'success', lastID: lastID, changes: changes});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});
/**
 * @api {delete} /recipient/:id Delete/Purge an existing recipient/payee
 * @apiParam {Number} id The payee reference ID
 * @apiDescription DOES NOT DELETE ANY CHECK REGISTER ITEMS ASSOCIATED WITH THE DELETED PAYEE!
 * @apiVersion 1.0.0
 * @apiName deletePayee
 * @apiGroup Payee
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request DELETE 'http://localhost:3000/recipient/3'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "rows": []
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.delete('/recipient/:id', function(req, res){
  purgeRecipient(req.params.id, 
    function(rows){
      res.json({status: 'success', rows: rows});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});

/**
 * Checkbook
 * - getAllItems
 * - getAllItemsByBankAccount
 * - getItemsRangeByBankAccount
 * - addCheckbookItem
 * - updateCheckbookItem
 * - backupCheckbookByRangeForBankAccount
 */
/**
 * @api {get} /register/items Retrieves all check register items
 * @apiVersion 1.0.0
 * @apiName getAllItems
 * @apiGroup Checkbook/Check Register
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request GET 'http://localhost:3000/register/items'
 * @apiSuccessExample {json} Success=Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "items": [
 *            {
 *              "no": 2,
 *              "date": "2022-01-15",
 *              "payee": "PressPage Entertainment Inc",
 *              "amount": 100,
 *              "memo": "Test",
 *              "image": "",
 *              "account": 2,
 *              "checkbookio": "{\"error\":\"not permitted\"}"
 *            }
 *         ]
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.get('/register/items', function(req, res){
  getCheckRegisterEntries(0, 
    function(rows){
      res.json({status: 'success', items: rows});
    }, function(error){
      res.json({status: 'error', message: error});
    });
});
/**
 * @api {get} /register/items/:id Retrieves all check register for a specific bank
 * @apiParam {Number} id The bank reference ID
 * @apiVersion 1.0.0
 * @apiName getItemsByAccount
 * @apiGroup Checkbook/Check Register
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request GET 'http://localhost:3000/register/items/2'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "items": [
 *          {
 *             "no": 2,
 *             "date": "2022-01-15",
 *             "payee": "PressPage Entertainment Inc",
 *             "amount": 100,
 *             "memo": "Test",
 *             "image": "",
 *             "account": 2,
 *             "checkbookio": "{\"error\":\"not permitted\"}"
 *          }
 *        ]
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
 api.get('/register/items/:id', function(req, res){
  getCheckRegisterEntries(req.params.id, 
    function(rows){
      res.json({status: 'success', items: rows});
    }, function(error){
      res.json({status: 'error', message: error});
    });
});
/**
 * @api {get} /register/items/range/:id,:from,:to Retrieves all check register for a specific bank within a date range
 * @apiParam {Number} id The bank reference ID
 * @apiParam {String} from The beginning date of the range
 * @apiParam {String} to The last date of the range
 * @apiVersion 1.0.0
 * @apiName getItemsByRange
 * @apiGroup Checkbook/Check Register
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request GET 'http://localhost:3000/register/items/range/2,2022-01-01,2022-01-30'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "items": [
 *          {
 *             "no": 2,
 *             "date": "2022-01-15",
 *             "payee": "PressPage Entertainment Inc",
 *             "amount": 100,
 *             "memo": "Test",
 *             "image": "",
 *             "account": 2,
 *             "checkbookio": "{\"error\":\"not permitted\"}"
 *           }
 *        ]
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
api.get('/register/items/range/:id,:from,:to', function(req, res){
  getCheckRegisterEntriesByRange(req.params.id,req.params.from,req.params.to, 
    function(rows){
      res.json({status: 'success', items: rows});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});
/**
 * @api {post} /register Creates a new check register item and payment
 * @apiBody {Number} id The bank reference ID
 * @apiBody {String} date The check date
 * @apiBody {String} name The payee
 * @apiBody {Number} amount The check amount
 * @apiBody {String} description The memo of the check
 * @apiBody {String} image The check image as an SVG
 * @apiDescription A new checkbook.io check payment instance is created as well as a new check register item entry in the database
 * @apiVersion 1.1.0
 * @apiName createNewItem
 * @apiGroup Checkbook/Check Register
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request POST 'http://localhost:3000/register' \
 *        --header 'Content-Type: application/x-www-form-urlencoded' \
 *        --data-urlencode 'id=2' \
 *        --data-urlencode 'date=2021-01-12' \
 *        --data-urlencode 'name=John Doe' \
 *        --data-urlencode 'amount=100.31' \
 *        --data-urlencode 'line_1=1 Main Street' \
 *        --data-urlencode 'line_2=Apt 1' \
 *        --data-urlencode 'city=New York' \
 *        --data-urlencode 'state=NY' \
 *        --data-urlencode 'zip=10001' \
 *        --data-urlencode 'country=US' \
 *        --data-urlencode 'description=Bonus' \
 *        --data-urlencode 'number=123456789' \
 *        --data-urlencode 'routing=123456789' \  
 *        --data-urlencode 'type=CHECKING'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "lastID": 4,
 *        "changes": 1,
 *        "checkbookio": "{\"error\":\"Invalid authorization header\"}\n"
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
api.post('/register', function(req, res){
  try {
    var env = settings['checkbook.io']['environment'];
    var auth = settings['checkbook.io'][env].authorization;
    var hostname = settings['checkbook.io'][env].hostname;
    var options = {
      'method': 'POST',
      'hostname': hostname,
      'path': '/v3/bank',
      'headers': {
        'Authorization': auth,
        'Content-Type': 'application/json'
      },
      'maxRedirects': 20
    };
    
    var httpsReq = https.request(options, function (httpsRes) {
      var chunks = [];
    
      httpsRes.on("data", function (chunk) {
        chunks.push(chunk);
      });
    
      httpsRes.on("end", function (chunk) {
        var body = Buffer.concat(chunks);
        console.log(body.toString());
        addCheckRegisterEntry(req.body.id, req.body.date, req.body.name, req.body.amount, req.body.description, req.body.image, body.toString(), 
          function(lastID, changes){
            res.json({status: 'success', lastID: lastID, changes: changes, checkbookio: body.toString()});
          }, 
          function(error){
            res.json({status: 'error', message: error});
          });
      });
    
      httpsRes.on("error", function (error) {
        res.json({status: 'error', message: error});
      });
    });
    
    var postData =  JSON.stringify({
      "recipient": {
        "line_1": req.body.line_1,
        "line_2": req.body.line_2,
        "city": req.body.city,
        "state": req.body.state,
        "zip": req.body.zip,
        "country": req.body.country
      },
      "name": req.body.name,
      "amount": req.body.amount,
      "description": req.body.description,
      "number": req.body.number,
      "account": req.body.account,
      "routing": req.body.routing,
      "type": req.body.type
    });
    httpsReq.write(postData);
    
    httpsReq.end();    
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
/**
 * @api {delete} /register/:id Delete all check register for a specific bank
 * @apiParam {Number} id The bank reference ID
 * @apiVersion 1.1.0
 * @apiName deleteCheckRegisterItem
 * @apiGroup Checkbook/Check Register
 * @apiExample {curl} Example usage:
 *     curl --silent --location --request DELETE 'http://localhost:3000/register/3'
 * @apiSuccessExample {json} Success-Response:
 *     HTTP/1.1 200 OK
 *     {
 *        "status": "success",
 *        "items": []
 *     }
 * @apiErrorExample {json} Error-Response:
 *     HTTP/1.1 404 Not Found
 *     {
 *       "status": "error",
 *       "message": "error or exception message"
 *     }
 */
api.delete('/register/:id', function(req, res){
  try {
    purgeCheckRegisterEntries(req.params.id, 
      function(rows){
        res.json({status: 'success', items: rows});
      }, 
      function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});


 const host = settings.host;
 const port = settings.port;
 
 api.listen(port, () => {
   console.log(`Checkbook API Server listening at http://${host}:${port}`)
 })