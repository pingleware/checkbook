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
  var sql = `SELECT * FROM accounts WHERE id=${ref}`;
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
  var sql = `SELECT * FROM checkregister WHERE account=${ref} AND date BETWEEN ${from} AND ${to} ORDER BY no`;
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
api.post('/account/add', function(req, res){
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
api.put('/account/edit/:id', function(req, res){
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
api.post('/account/backup/:id', function(req, res){
  try {
    backupBankAccount(req.params.id, 
      function(rows){
        res.json({status: 'success', account: rows});
      }, function(error){
        res.json({status: 'error', message: error});
      });
  } catch(error) {
    res.json({status: 'error', message: error});
  }
});
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
api.put('/account/balance/:id,:amount', function(req, res){
  try {
    updateBalance(req.params.id,req.params.amount, 
      function(lastId, changes){
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
api.get('/recipients', function(req, res){
  getRecipients(
    function(rows){
      res.json({status: 'success', recipients: rows});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});
api.post('/recipient', function(req, res){
  addRecipient(req.body.params, 
    function(lastID, changes){
      res.json({status: 'success', lastID: lastID, changes: changes});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});
api.put('/recipient', function(req, res){
  updateRecipient(req.body.params, 
    function(lastID, changes){
      res.json({status: 'success', lastID: lastID, changes: changes});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});
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
api.get('/register/items', function(req, res){
  getCheckRegisterEntries(0, 
    function(rows){
      res.json({status: 'success', items: rows});
    }, function(error){
      res.json({status: 'error', message: error});
    });
});
api.get('/register/items/:id', function(req, res){
  getCheckRegisterEntries(req.params.id, 
    function(rows){
      res.json({status: 'success', items: rows});
    }, function(error){
      res.json({status: 'error', message: error});
    });
});
api.get('/register/items/range/:id,:from,:to', function(req, res){
  getCheckRegisterEntriesByRange(req.params.id,req.params.from,req.params.to, 
    function(rows){
      res.json({status: 'success', items: rows});
    }, 
    function(error){
      res.json({status: 'error', message: error});
    });
});

 const host = settings.host;
 const port = settings.port;
 
 api.listen(port, () => {
   console.log(`Checkbook API Server listening at http://${host}:${port}`)
 })