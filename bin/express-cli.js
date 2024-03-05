#!/usr/bin/env node

const ejs = require('ejs');
const fs = require('fs');
const minimatch = require('minimatch');
const mkdirp = require('mkdirp');
const parseArgs = require('minimist');
const path = require('path');
const readline = require('readline');
const sortedObject = require('sorted-object');
const util = require('util');

const MODE_0666 = parseInt('0666', 8);
const MODE_0755 = parseInt('0755', 8);
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const VERSION = require('../package').version;

// parse args
const unknown = [];
const args = parseArgs(process.argv.slice(2), {
  alias: {
    c: 'css',
    e: 'ejs',
    f: 'force',
    h: 'help',
    v: 'view'
  },
  boolean: ['ejs', 'force', 'git', 'help', 'version'],
  default: { css: true, view: true },
  string: ['css', 'view'],
  unknown: function (s) {
    if (s.charAt(0) === '-') {
      unknown.push(s)
    }
  }
})

args['!'] = unknown;

// run
main(args, exit);

/**
 * Prompt for confirmation on STDOUT/STDIN
 */

function confirm(msg, callback) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.question(msg, function (input) {
    rl.close();
    callback(/^y|yes|ok|true$/i.test(input));
  })
}

/**
 * Copy file from template directory.
 */

function copyTemplate(from, to) {
  write(to, fs.readFileSync(path.join(TEMPLATE_DIR, from), 'utf-8'));
}

/**
 * Copy multiple files from template directory.
 */

function copyTemplateMulti(fromDir, toDir, nameGlob) {
  fs.readdirSync(path.join(TEMPLATE_DIR, fromDir))
    .filter(minimatch.filter(nameGlob, { matchBase: true }))
    .forEach((name) => {
      copyTemplate(path.join(fromDir, name), path.join(toDir, name))
    })
}

/**
 * Create application at the given directory.
 *
 * @param {string} name
 * @param {string} dir
 * @param {object} options
 * @param {function} done
 */

function createApplication(name, dir, options, done) {
  console.log();

  // Package
  const pkg = {
    name: name,
    version: '0.0.0',
    private: true,
    scripts: {
      start: 'node ./bin/www'
    },
    dependencies: {
      debug: '~4.3.4',
      express: '~4.18.2'
    }
  }

  // JavaScript
  const app = loadTemplate('js/app.js');
  const www = loadTemplate('js/www');

  // App name
  www.locals.name = name

  // App modules
  app.locals.localModules = Object.create(null);
  app.locals.modules = Object.create(null);
  app.locals.mounts = [];
  app.locals.uses = [];

  // Request logger
  app.locals.modules.logger = 'morgan';
  app.locals.uses.push("logger('dev')");
  pkg.dependencies.morgan = '~1.10.0';

  // Body parsers
  if (options.view) {
    app.locals.uses.push('express.urlencoded({ extended:true })');
  }
  else {
    app.locals.uses.push('express.json()');
  }

  // Cookie parser
  app.locals.modules.cookieParser = 'cookie-parser';
  app.locals.uses.push('cookieParser()');
  pkg.dependencies['cookie-parser'] = '~1.4.6';

  if (dir !== '.') {
    mkdir(dir, '.');
  }

  mkdir(dir, 'public');
  mkdir(dir, 'public/javascript');
  mkdir(dir, 'public/images');
  mkdir(dir, 'public/stylesheets');

  copyTemplateMulti('css', dir + '/public/stylesheets', '*.css');

  // copy route templates
  mkdir(dir, 'routes');
  copyTemplateMulti('js/routes', dir + '/routes', '*.js');

  if (options.view) {
    // Copy view templates
    mkdir(dir, 'views');
    pkg.dependencies['http-errors'] = '~2.0.0';
    copyTemplateMulti('views', dir + '/views', '*.ejs');
  } else {
    // Copy extra public files
    copyTemplate('js/index.html', path.join(dir, 'public/index.html'));
  }

  // Index router mount
  app.locals.localModules.indexRouter = './routes/index';
  app.locals.mounts.push({ path: '/', code: 'indexRouter' });

  // User router mount
  app.locals.localModules.usersRouter = './routes/users';
  app.locals.mounts.push({ path: '/users', code: 'usersRouter' });

  // Template support
  switch (options.view) {
    case 'ejs':
      app.locals.view = { engine: 'ejs' };
      pkg.dependencies.ejs = '~3.1.9';
      break
    default:
      app.locals.view = false;
      break
  }

  // Static files
  app.locals.uses.push("express.static(path.join(__dirname, 'public'))");

  //git ignore by default
  copyTemplate('js/gitignore', path.join(dir, '.gitignore'));

  // sort dependencies like npm(1)
  pkg.dependencies = sortedObject(pkg.dependencies);

  // write files
  write(path.join(dir, 'app.js'), app.render());
  write(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  mkdir(dir, 'bin');
  write(path.join(dir, 'bin/www'), www.render(), MODE_0755);

  const prompt = launchedFromCmd() ? '>' : '$';

  if (dir !== '.') {
    console.log();
    console.log('   change directory:');
    console.log('     %s cd %s', prompt, dir);
  }

  console.log();
  console.log('   install dependencies:');
  console.log('     %s npm install', prompt);
  console.log();
  console.log('   run the app:');

  if (launchedFromCmd()) {
    console.log('     %s SET DEBUG=%s:* & npm start', prompt, name);
  } else {
    console.log('     %s DEBUG=%s:* npm start', prompt, name);
  }

  console.log();

  done(0);
}

/**
 * Create an app name from a directory path, fitting npm naming requirements.
 *
 * @param {String} pathName
 */

function createAppName(pathName) {
  return path.basename(pathName)
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/^[-_.]+|-+$/g, '')
    .toLowerCase()
}

/**
 * Check if the given directory `dir` is empty.
 *
 * @param {String} dir
 * @param {Function} fn
 */

function emptyDirectory(dir, fn) {
  fs.readdir(dir, function (err, files) {
    if (err && err.code !== 'ENOENT') throw err;
    fn(!files || !files.length);
  })
}

/**
 * Display an error.
 *
 * @param {String} message
 */

function error(message) {
  console.error();
  message.split('\n').forEach(function (line) {
    console.error('  error: %s', line)
  })
  console.error();
}

/**
 * Graceful exit for async STDIO
 */

function exit(code) {
  // flush output for Node.js Windows pipe bug
  // https://github.com/joyent/node/issues/6247 is just one bug example
  // https://github.com/visionmedia/mocha/issues/333 has a good discussion
  function done() {
    if (!(draining--)) process.exit(code);
  }

  let draining = 0;
  const streams = [process.stdout, process.stderr];

  exit.exited = true;

  streams.forEach((stream) => {
    // submit empty write request and wait for completion
    draining += 1;
    stream.write('', done);
  })

  done();
}

/**
 * Determine if launched from cmd.exe
 */

function launchedFromCmd() {
  return process.platform === 'win32' &&
    process.env._ === undefined
}

/**
 * Load template file.
 */

function loadTemplate(name) {
  const contents = fs.readFileSync(path.join(__dirname, '..', 'templates', (name + '.ejs')), 'utf-8');
  const locals = Object.create(null);

  function render() {
    return ejs.render(contents, locals, {
      escape: util.inspect
    })
  }

  return {
    locals: locals,
    render: render
  }
}

/**
 * Main program.
 */

function main(options, done) {
  // top-level argument direction
  if (options['!'].length > 0) {
    usage();
    error('unknown option `' + options['!'][0] + "'");
    done(1);
  } else if (args.help) {
    usage();
    done(0);
  } else if (args.version) {
    version();
    done(0);
  } else if (options.css === '') {
    usage();
    error('option `-c, --css <engine>\' argument missing');
    done(1);
  } else if (options.view === '') {
    usage();
    error('option `-v, --view <engine>\' argument missing');
    done(1);
  } else {
    // Path
    const destinationPath = options._[0] || '.';

    // App name
    const appName = createAppName(path.resolve(destinationPath)) || 'hello-world';

    // Default view engine
    if (options.view === true) {
      options.view = 'ejs';
    }

    // Generate application
    emptyDirectory(destinationPath, function (empty) {
      if (empty || options.force) {
        createApplication(appName, destinationPath, options, done);
      } else {
        confirm('destination is not empty, continue? [y/N] ', function (ok) {
          if (ok) {
            process.stdin.destroy();
            createApplication(appName, destinationPath, options, done);
          } else {
            console.error('aborting');
            done(1);
          }
        })
      }
    })
  }
}

/**
 * Make the given dir relative to base.
 *
 * @param {string} base
 * @param {string} dir
 */

function mkdir(base, dir) {
  const loc = path.join(base, dir);

  console.log('   \x1b[36mcreate\x1b[0m : ' + loc + path.sep);
  mkdirp.sync(loc, MODE_0755);
}

/**
 * Display the usage.
 */

function usage() {
  console.log('');
  console.log('  Usage: express [options] [dir]');
  console.log('');
  console.log('  Options:');
  console.log('');
  console.log('    -e, --ejs            add ejs engine support');
  console.log('    -v, --view <engine>  add view <engine> support (ejs) (defaults to EJS)');
  console.log('        --no-view        use static html instead of view engine');
  console.log('    -f, --force          force on non-empty directory');
  console.log('    --version            output the version number');
  console.log('    -h, --help           output usage information');
}

/**
 * Display the version.
 */

function version() {
  console.log(VERSION);
}

/**
 * Display a warning.
 *
 * @param {String} message
 */

function warning(message) {
  console.error();
  message.split('\n').forEach((line) => {
    console.error('  warning: %s', line)
  })
  console.error();
}

/**
 * echo str > file.
 *
 * @param {String} file
 * @param {String} str
 */

function write(file, str, mode) {
  fs.writeFileSync(file, str, { mode: mode || MODE_0666 });
  console.log('   \x1b[36mcreate\x1b[0m : ' + file);
}
