
const assert = require('assert');
const AppRunner = require('./support/app-runner');
const exec = require('child_process').exec;
const fs = require('fs');
const { mkdirp, mkdirpSync } = require('mkdirp');
const path = require('path');
const request = require('supertest');
const { rimrafSync } = require('rimraf');
const spawn = require('child_process').spawn;
const utils = require('./support/utils');
const validateNpmName = require('validate-npm-package-name');

const APP_START_STOP_TIMEOUT = 10000;
const PKG_PATH = path.resolve(__dirname, '..', 'package.json');
const BIN_PATH = path.resolve(path.dirname(PKG_PATH), require(PKG_PATH).bin.express);
const NPM_INSTALL_TIMEOUT = 300000; // 5 minutes
const STDERR_MAX_BUFFER = 5 * 1024 * 1024; // 5mb
const TEMP_DIR = utils.tmpDir();

describe('express(1)', function () {
  after(function () {
    this.timeout(30000);
    rimrafSync(TEMP_DIR);
  })

  describe('(no args)', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should create basic app', function (done) {
      run(ctx.dir, [], function (err, stdout, warnings) {
        if (err) return done(err)
        ctx.files = utils.parseCreatedFiles(stdout, ctx.dir)
        ctx.stdout = stdout
        ctx.warnings = warnings
        assert.strictEqual(ctx.files.length, 15)
        done()
      })
    })

    it('should provide debug instructions', function () {
      assert.ok(/DEBUG=express-1-no-args:\* (?:& )?npm start/.test(ctx.stdout))
    })

    it('should have basic files', function () {
      assert.notStrictEqual(ctx.files.indexOf('bin/www'), -1)
      assert.notStrictEqual(ctx.files.indexOf('app.js'), -1)
      assert.notStrictEqual(ctx.files.indexOf('package.json'), -1)
    })

    it('should have a package.json file', function () {
      const file = path.resolve(ctx.dir, 'package.json')
      const contents = fs.readFileSync(file, 'utf8')
      assert.strictEqual(contents, '{\n' +
        '  "name": "express-1-no-args",\n' +
        '  "version": "0.0.0",\n' +
        '  "private": true,\n' +
        '  "scripts": {\n' +
        '    "start": "node ./bin/www"\n' +
        '  },\n' +
        '  "dependencies": {\n' +
        '    "cookie-parser": "~1.4.6",\n' +
        '    "debug": "~4.3.4",\n' +
        '    "ejs": "~3.1.9",\n' +
        '    "express": "~4.18.2",\n' +
        '    "http-errors": "~2.0.0",\n' +
        '    "morgan": "~1.10.0"\n' +
        '  }\n' +
        '}\n')
    })

    it('should have installable dependencies', function (done) {
      this.timeout(NPM_INSTALL_TIMEOUT)
      npmInstall(ctx.dir, done)
    })

    it('should export an express app from app.js', function () {
      const file = path.resolve(ctx.dir, 'app.js')
      const app = require(file)
      assert.strictEqual(typeof app, 'function')
      assert.strictEqual(typeof app.handle, 'function')
    })

    describe('npm start', function () {
      before('start app', function () {
        this.app = new AppRunner(ctx.dir)
      })

      after('stop app', function (done) {
        this.timeout(APP_START_STOP_TIMEOUT)
        this.app.stop(done)
      })

      it('should start app', function (done) {
        this.timeout(APP_START_STOP_TIMEOUT)
        this.app.start(done)
      })

      it('should respond to HTTP request', function (done) {
        request(this.app)
          .get('/')
          .expect(200, /<title>Express<\/title>/, done)
      })

      it('should generate a 404', function (done) {
        request(this.app)
          .get('/does_not_exist')
          .expect(404, /<h1>Not Found<\/h1>/, done)
      })
    })

    describe('when directory contains spaces', function () {
      const ctx0 = setupTestEnvironment('foo bar (BAZ!)')

      it('should create basic app', function (done) {
        run(ctx0.dir, [], function (err, output) {
          if (err) return done(err)
          assert.strictEqual(utils.parseCreatedFiles(output, ctx0.dir).length, 15)
          done()
        })
      })

      it('should have a valid npm package name', function () {
        const file = path.resolve(ctx0.dir, 'package.json')
        const contents = fs.readFileSync(file, 'utf8')
        const name = JSON.parse(contents).name
        assert.ok(validateNpmName(name).validForNewPackages, 'package name "' + name + '" is valid')
        assert.strictEqual(name, 'foo-bar-baz')
      })
    })

    describe('when directory is not a valid name', function () {
      const ctx1 = setupTestEnvironment('_')

      it('should create basic app', function (done) {
        run(ctx1.dir, [], function (err, output) {
          if (err) return done(err)
          assert.strictEqual(utils.parseCreatedFiles(output, ctx1.dir).length, 15)
          done()
        })
      })

      it('should default to name "hello-world"', function () {
        const file = path.resolve(ctx1.dir, 'package.json')
        const contents = fs.readFileSync(file, 'utf8')
        const name = JSON.parse(contents).name
        assert.ok(validateNpmName(name).validForNewPackages)
        assert.strictEqual(name, 'hello-world')
      })
    })
  })

  describe('(unknown args)', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should exit with code 1', function (done) {
      runRaw(ctx.dir, ['--foo'], function (err, code, stdout, stderr) {
        if (err) return done(err)
        assert.strictEqual(code, 1)
        done()
      })
    })

    it('should print usage', function (done) {
      runRaw(ctx.dir, ['--foo'], function (err, code, stdout, stderr) {
        if (err) return done(err)
        assert.ok(/Usage: express /.test(stdout))
        assert.ok(/--help/.test(stdout))
        assert.ok(/--version/.test(stdout))
        assert.ok(/error: unknown option/.test(stderr))
        done()
      })
    })

    it('should print unknown option', function (done) {
      runRaw(ctx.dir, ['--foo'], function (err, code, stdout, stderr) {
        if (err) return done(err)
        assert.ok(/error: unknown option/.test(stderr))
        done()
      })
    })
  })

  describe('<dir>', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should create basic app in directory', function (done) {
      runRaw(ctx.dir, ['foo'], function (err, code, stdout, stderr) {
        if (err) return done(err)
        ctx.files = utils.parseCreatedFiles(stdout, ctx.dir)
        ctx.stderr = stderr
        ctx.stdout = stdout
        assert.strictEqual(ctx.files.length, 16)
        done()
      })
    })

    it('should provide change directory instructions', function () {
      assert.ok(/cd foo/.test(ctx.stdout))
    })

    it('should provide install instructions', function () {
      assert.ok(/npm install/.test(ctx.stdout))
    })

    it('should provide debug instructions', function () {
      assert.ok(/DEBUG=foo:\* (?:& )?npm start/.test(ctx.stdout))
    })

    it('should have basic files', function () {
      assert.notStrictEqual(ctx.files.indexOf('foo/bin/www'), -1)
      assert.notStrictEqual(ctx.files.indexOf('foo/app.js'), -1)
      assert.notStrictEqual(ctx.files.indexOf('foo/package.json'), -1)
    })

    it('should have ejs templates', function () {
      assert.notStrictEqual(ctx.files.indexOf('foo/views/error.ejs'), -1)
      assert.notStrictEqual(ctx.files.indexOf('foo/views/index.ejs'), -1)
    })
  })

  describe('--css <engine>', function () {
    describe('(no engine)', function () {
      var ctx = setupTestEnvironment(this.fullTitle())

      it('should exit with code 1', function (done) {
        runRaw(ctx.dir, ['--css'], function (err, code, stdout, stderr) {
          if (err) return done(err)
          assert.strictEqual(code, 1)
          done()
        })
      })

      it('should print usage', function (done) {
        runRaw(ctx.dir, ['--css'], function (err, code, stdout) {
          if (err) return done(err)
          assert.ok(/Usage: express /.test(stdout))
          assert.ok(/--help/.test(stdout))
          assert.ok(/--version/.test(stdout))
          done()
        })
      })

      it('should print argument missing', function (done) {
        runRaw(ctx.dir, ['--css'], function (err, code, stdout, stderr) {
          if (err) return done(err)
          assert.ok(/error: option .* argument missing/.test(stderr))
          done()
        })
      })
    })
  })

  describe('--ejs', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should create basic app with ejs templates', function (done) {
      run(ctx.dir, ['--ejs'], function (err, stdout, warnings) {
        if (err) return done(err)
        ctx.warnings = warnings
        ctx.files = utils.parseCreatedFiles(stdout, ctx.dir)
        assert.strictEqual(ctx.files.length, 15, 'should have 15 files')
        done()
      })
    })

    it('should have basic files', function () {
      assert.notStrictEqual(ctx.files.indexOf('bin/www'), -1, 'should have bin/www file')
      assert.notStrictEqual(ctx.files.indexOf('app.js'), -1, 'should have app.js file')
      assert.notStrictEqual(ctx.files.indexOf('package.json'), -1, 'should have package.json file')
    })

    it('should have ejs templates', function () {
      assert.notStrictEqual(ctx.files.indexOf('views/error.ejs'), -1, 'should have views/error.ejs file')
      assert.notStrictEqual(ctx.files.indexOf('views/index.ejs'), -1, 'should have views/index.ejs file')
    })
  })

  describe('--git', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should create basic app with git files', function (done) {
      run(ctx.dir, ['--git'], function (err, stdout) {
        if (err) return done(err)
        ctx.files = utils.parseCreatedFiles(stdout, ctx.dir)
        assert.strictEqual(ctx.files.length, 16, 'should have 16 files')
        done()
      })
    })

    it('should have basic files', function () {
      assert.notStrictEqual(ctx.files.indexOf('bin/www'), -1, 'should have bin/www file')
      assert.notStrictEqual(ctx.files.indexOf('app.js'), -1, 'should have app.js file')
      assert.notStrictEqual(ctx.files.indexOf('package.json'), -1, 'should have package.json file')
    })

    it('should have .gitignore', function () {
      assert.notStrictEqual(ctx.files.indexOf('.gitignore'), -1, 'should have .gitignore file')
    })

    it('should have ejs templates', function () {
      assert.notStrictEqual(ctx.files.indexOf('views/error.ejs'), -1)
      assert.notStrictEqual(ctx.files.indexOf('views/index.ejs'), -1)
    })
  })

  describe('-h', function () {
    var ctx = setupTestEnvironment(this.fullTitle())

    it('should print usage', function (done) {
      run(ctx.dir, ['-h'], function (err, stdout) {
        if (err) return done(err)
        var files = utils.parseCreatedFiles(stdout, ctx.dir)
        assert.strictEqual(files.length, 0)
        assert.ok(/Usage: express /.test(stdout))
        assert.ok(/--help/.test(stdout))
        assert.ok(/--version/.test(stdout))
        done()
      })
    })
  })

  describe('--help', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should print usage', function (done) {
      run(ctx.dir, ['--help'], function (err, stdout) {
        if (err) return done(err)
        const files = utils.parseCreatedFiles(stdout, ctx.dir)
        assert.strictEqual(files.length, 0)
        assert.ok(/Usage: express /.test(stdout))
        assert.ok(/--help/.test(stdout))
        assert.ok(/--version/.test(stdout))
        done()
      })
    })
  })

  describe('--no-view', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should create basic app without view engine', function (done) {
      run(ctx.dir, ['--no-view'], function (err, stdout) {
        if (err) return done(err)
        ctx.files = utils.parseCreatedFiles(stdout, ctx.dir)
        assert.strictEqual(ctx.files.length, 13)
        done()
      })
    })

    it('should have basic files', function () {
      assert.notStrictEqual(ctx.files.indexOf('bin/www'), -1)
      assert.notStrictEqual(ctx.files.indexOf('app.js'), -1)
      assert.notStrictEqual(ctx.files.indexOf('package.json'), -1)
    })

    it('should not have views directory', function () {
      assert.strictEqual(ctx.files.indexOf('views'), -1)
    })

    it('should have installable dependencies', function (done) {
      this.timeout(NPM_INSTALL_TIMEOUT)
      npmInstall(ctx.dir, done)
    })

    describe('npm start', function () {
      before('start app', function () {
        this.app = new AppRunner(ctx.dir)
      })

      after('stop app', function (done) {
        this.timeout(APP_START_STOP_TIMEOUT)
        this.app.stop(done)
      })

      it('should start app', function (done) {
        this.timeout(APP_START_STOP_TIMEOUT)
        this.app.start(done)
      })

      it('should respond to HTTP request', function (done) {
        request(this.app)
          .get('/')
          .expect(200, /<title>Express<\/title>/, done)
      })

      it('should generate a 404', function (done) {
        request(this.app)
          .get('/does_not_exist')
          .expect(404, /Cannot GET \/does_not_exist/, done)
      })
    })
  })

  describe('--version', function () {
    const ctx = setupTestEnvironment(this.fullTitle())

    it('should print version', function (done) {
      const pkg = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
      const ver = JSON.parse(pkg).version
      run(ctx.dir, ['--version'], function (err, stdout) {
        if (err) return done(err)
        assert.strictEqual(stdout.replace(/[\r\n]+/, '\n'), ver + '\n')
        done()
      })
    })
  })
})

function npmInstall(dir, callback) {
  const env = utils.childEnvironment()

  exec('npm install', { cwd: dir, env: env, maxBuffer: STDERR_MAX_BUFFER }, function (err, stderr) {
    if (err) {
      err.message += stderr
      callback(err)
      return
    }

    callback()
  })
}

function run(dir, args, callback) {
  runRaw(dir, args, function (err, code, stdout, stderr) {
    if (err) {
      return callback(err)
    }

    process.stderr.write(utils.stripWarnings(stderr))

    try {
      assert.strictEqual(utils.stripWarnings(stderr), '')
      assert.strictEqual(code, 0)
    } catch (e) {
      return callback(e)
    }

    callback(null, utils.stripColors(stdout), utils.parseWarnings(stderr))
  })
}

function runRaw(dir, args, callback) {
  const argv = [BIN_PATH].concat(args)
  const binp = process.argv[0]
  let stderr = ''
  let stdout = ''

  const child = spawn(binp, argv, {
    cwd: dir
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', function ondata(str) {
    stdout += str
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', function ondata(str) {
    stderr += str
  })

  child.on('close', onclose)
  child.on('error', callback)

  function onclose(code) {
    callback(null, code, stdout, stderr)
  }
}

function setupTestEnvironment(name) {
  const ctx = {}

  before('create environment', function () {
    ctx.dir = path.join(TEMP_DIR, name.replace(/[<>]/g, ''))
    mkdirpSync(ctx.dir)
  })

  after('cleanup environment', function () {
    this.timeout(30000)
    rimrafSync(ctx.dir)
  })

  return ctx
}
