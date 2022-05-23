var vm = require('vm')
var fs = require('fs')
var path = require('path')
var { URL } = require('url')

function transform(str, u) {
    var data = str
    var ld = str.indexOf('__webpack_require__.l = (url, done, key, chunkId)')
    if (~ld) {
        str = str.substring(0, ld) + '__webpack_require__.l = window.localRequire;return;' + str.substring(ld)
    }
    var pub = str.indexOf('/******/ 	/* webpack/runtime/publicPath */')
    if (~pub) {
        var s = pub + str.substring(pub).indexOf('var scriptUrl;')
        str = str.substring(0, s) + '__webpack_require__.p = "' + u + '/";return; ' + str.substring(s)
    }
    var exp = str.indexOf('/******/ 	window.$$')
    if (~exp) {
        var s = exp + str.substring(exp).indexOf(' 	')
        data = str.substring(0, s) + 'window.__uiux_import__ = window.__create_import__(__webpack_require__);' + str.substring(s)
    }
    return data
    // return 'debugger;' + data
}

var loc = './tmp/'

var d = path.resolve(__dirname, loc)
if (!fs.existsSync(d)) {
    fs.mkdirSync(d)
}
function convertUrl(url) {
    var u = new URL(url)
    var { hostname, port, pathname } = u
    return [hostname, port, pathname.replace(/\//g, '_').replace(/[\\:\*\?\|\"\<\>]/g, '#')].join('-')
}
function getRemote(base, file = '') {
    var url = base + file
    console.log('fetching', url, __dirname)
    if (url.startsWith('http://') || url.startsWith('https://')) {
        var local = loc + convertUrl(url)
        return new Promise((resolve, reject) => {
            try {
                // require.resolve(local) //can't recognize
                var isLocal = ['localhost'].includes(new URL(url).hostname)
                if (isLocal) {
                    throw null
                }
                require(local)
                console.log('import ok', local)
                resolve()
            }
            catch (e) {
                console.log('cache not found, fetching remote...', local)
                fetch(url)
                    .then(x => {
                        console.log('url responded, ', url)
                        if (x.status === 200)
                            return x.text()
                        else {
                            throw {
                                code: x.status
                                , url
                            }
                        }
                    })
                    .then(x => {
                        var code = transform(x, base)
                        var g = { ...window, WebSocket, window, self: window }
                        vm.createContext(g);
                        if (!isLocal) {
                            fs.writeFileSync(path.resolve(__dirname, local), code)
                            console.log('file written, ', url, path.resolve(__dirname, local))
                        }
                        vm.runInContext(code, g)
                        resolve(code)

                    })
            }
        })

    }
    else {
        var hostRoot = '../../'
        url = hostRoot + (window.__dist__ || 'dist') + '/' + (file || base)
        return new Promise((resolve, reject) => {
            require(url)
            resolve()
        })
    }
}
window.__loader__ = (name) => {
    return new Promise((resolve, reject) => {
        var u = window.__URLS__[name]
        if (u) {
            var key = '$$' + name
            var pkey = '__$$' + name
            var pro = window[pkey]
            if (!pro) {
                window[pkey] = pro = getRemote(u, '/remoteEntry.js')
            }
            if (!window[key]) {
                pro.then(x => {
                    console.log('......fresh, ', key)
                    resolve(window[key])
                })
                    .catch(e => {
                        console.log(key, e)
                    })
            }
            else {
                console.log('.....cached.', key)
                resolve(window[key])
            }
        }
        else {
            resolve({
                get: (mod) => () => ({ default: name + '://' + mod + ' not found' })
                , init: () => null
            })
        }
    })
}
var inProgress = {}
window.localRequire = (url, done, key, chunkId) => {
    if (inProgress[url]) { inProgress[url].push(done); return; }
    try {
        getRemote(url).then(x => {
            doneFns && doneFns.forEach((fn) => (fn()))
        })
        var doneFns = inProgress[url];
        delete inProgress[url]
    } catch (e) {
        console.log(e)
    }
}
window.use = async (uri) => {
    var module

    var [domain, mod, scope = 'default'] = uri.split('://')
    if (window.__uiux_import__) {
        module = await window.__uiux_import__(uri)
    }
    else {
        var container = await window.__loader__(domain)
        var { init } = container
        await init({})
        module = await getModule(container, uri)
    }
    if (scope === 'default')
        return module.default
    else return module
}
window.__create_import__ = (__webpack_require__) => {
    __webpack_require__.l = window.localRequire
    return async (uri) => {
        var [domain, mod, scope = 'default'] = uri.split('://')
        if (domain && mod) {
            if (window.__tmpl_cache__[uri]) return Promise.resolve({ default: window.__tmpl_cache__[uri] })

            var container = await window.__loader__(domain)
            if (container && container.init) {
                await container.init(__webpack_require__.S.default)
            }
            else {
                throw {
                    message: 'domain name "' + domain + '" doesn\'t have the init method'
                }
            }
            return await getModule(container, uri)
        }
        else {
            throw {
                message: 'The name ' + uri + ' is not corrected, please use the format domain://module or domain://module://scope'
            }
        }
    }
}
window.__tmpl_cache__ = window.__tmpl_cache__ || {}
async function getModule(container, uri) {
    var [domain, mod, scope = 'default'] = uri.split('://')
    var { proxy, module: mods } = container.manifest
    var mod1 = './' + mod, scope1 = scope
    var useProxy = proxy && !mods[mod1]
    if (useProxy) {
        var [pMod, pScope = 'default'] = proxy.split('://')
        mod1 = pMod.startsWith('./') ? pMod : './' + pMod
        scope1 = pScope
    }
    var factory = await container.get(mod1)
    var module = factory()
    var exp = module[scope1]
    if (!exp && scope1 == 'default') {
        exp = module
    }
    if (exp) {
        window.__tmpl_cache__[uri] = useProxy ? exp(mod, scope) : exp
        return Promise.resolve({ default: window.__tmpl_cache__[uri] })
    }
    throw {
        message: domain + '://' + mod + ' is found, but the exported "' + scope + '" is not found, please check the name'
    }
}
