const chai = require('chai');
chai.use(require('chai-json-schema'));
const assert = chai.assert
const json = require('./json')
const schemaGen = require('./schema-gen')
const argv = require('minimist')(process.argv.slice(2));

let request = null;
let server = null;

// --server 'http://127.0.0.1:10080'
if (argv.server) { // remote mode. access by chai-http
  const chaiHttp = require('chai-http')
  chai.use(chaiHttp);
  request = chai.request
  server = argv.server
} else { // local mode, access by supertest.
  request = require('supertest')
  server = require('../../app.js')
}

function isArray(value) {
  return typeof (value) === 'object' && Array.isArray(value)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setHeaders(req, headers) {
  if (headers) {
    for (const key in headers) {
      const value = headers[key]
      req.set(key, value)
    }
    if (headers.redirects !== undefined) {
      req.redirects(headers.redirects)
    }
  }
  return req
}

async function httpPost(url, headers, body) {
  const data = JSON.stringify(body)
  const req = request(server).post(url)
  setHeaders(req, headers)
  const res = await req.send(data)

  return res
}

async function httpGet(url, headers, args) {
  const req = request(server).get(url)
  setHeaders(req, headers)
  const res = await req.query(args)
  return res
}

async function checkResponse(res, status, schema, match, notMatch) {
  if (argv.schema) {
    const deep = argv.deep || 4;
    const method = res.req.method;
    const path = res.req.path;
    console.log('/************** request: [%s %s] ****************/', method, path)
    if(res.body && res.body.data) {
      console.log('/***************** schema of data(deep: %d) ******************/', deep)
      const schema = schemaGen.autoSchema(res.body.data, {deep})
      console.log(json.dumps(schema))
    } else {
      const schema = schemaGen.autoSchema(res.body, {deep})
      console.log(json.dumps(schema))
    }
  }

  if (status == undefined) {
    status = 200
  }
  if (status) {
    assert.equal(res.status, status, `expect status (${status}), but res.status (${res.status})`);
  }

  if (match) {
    if (isArray(match)) {
      for (const pattern of match) {
        assert.match(res.text, new RegExp(pattern), `response text not matched regex: ${pattern}`)
      }
    } else {
      const pattern = match;
      assert.match(res.text, new RegExp(pattern), `response text not matched regex: ${pattern}`)
    }
  }
  if (notMatch) {
    if (isArray(notMatch)) {
      for (const pattern of notMatch) {
        assert.notMatch(res.text, new RegExp(pattern), `response text matched regex: ${pattern}`)
      }
    } else {
      const pattern = notMatch;
      assert.notMatch(res.text, new RegExp(pattern), `response text matched regex: ${pattern}`)
    }
  }

  if (schema) {
    // 由于响应的body可能没读取完, 这里做了等待.
    if (argv.encrypt) {
      const contentLength = res.headers['content-length']
      const sleepMs = 100
      for (let i=0; i < 20; i++) {
        if (res.recvLength >= contentLength) {
          break;
        }
        console.log('contentLength: %d, recvLength: %d, sleep(%s) for wait...', contentLength, res.recvLength, sleepMs)
        await sleep(sleepMs);
      }
    }
    assert.jsonSchema(res.body, schema, `res.body[[${JSON.stringify(res.body)}]]`)
  }
}

async function get(options) {
  const {url, headers, args, status, schema, match, notMatch} = options;
  const res = await httpGet(url, headers, args)
  if (argv.log) {
    console.log('>>> request [%s %s] headers: %o, args: %o', 'GET', url, headers, args)
    console.log('>>> response status: %d, body: %o', res.status, res.body)
  }

  await checkResponse(res, status, schema, match, notMatch)
  return res;
}

async function post(options) {
  const {url, headers, body, status, schema, match, notMatch} = options;
  if (headers && typeof(headers) === 'object' && typeof(body) === 'object') {
    headers['Content-type'] = 'application/json; charset=utf-8'
  }
  const res = await httpPost(url, headers, body)
  if (argv.log) {
    console.log('>>> request [%s %s] headers: %o, body: %o', 'POST', url, headers, body)
    console.log('>>> response status: %d, body: %o', res.status, res.body)
  }
  await checkResponse(res, status, schema, match, notMatch)
  return res;
}

function onFailed(callback, args) {
  afterEach(function(){
    const {title, state, duration, timedOut, err} = this.currentTest
    if (state !== 'passed') {
      const errmsg = `Test [${title}] ${state}, duration: ${duration}, err: ${err.message}`
      if(callback) {
        args = args || {}
        args.currentTest = this.currentTest
        callback(errmsg, args)
      }
    }
  })
}

exports.onFailed = onFailed;
exports.setHeaders = setHeaders;
exports.httpPost = httpPost;
exports.httpGet = httpGet;
exports.get = get;
exports.post = post;
