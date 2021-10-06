
var ModuleCache = {}
var TmplCache = {}
var TypeLib = {}

function unload(element) {
    document.head.removeChild(element);
}

function loadScript(url) {
    var element = document.createElement("script");

    element.src = url
    element.type = "text/javascript"
    element.async = true
    document.head.appendChild(element)
    return new Promise((resolve, reject) => {

        element.onload = () => {
            console.log(`Dynamic Script Loaded: ${url}`);
            unload(element)
            resolve();
        }
        element.onerror = () => {
            console.error(`Dynamic Script Error: ${url}`);
            unload(element)
            reject()
        }

    })
}
/**
    {
        './manifest': './src/manifest.js
 
    }
 */

async function loadDomain(domain, ver) {
    if (ModuleCache[domain]) {
        return !!ModuleCache[domain].proxyModule
    }
    // Initializes the share scope. This fills it with known provided modules from this build and all remotes
    await __webpack_init_sharing__("default")
    
    if (!window[domain+'_loader']) {
        window[domain+'_loader'] = await scriptLoader(domain, ver)
    }
    else {
        return window[domain+'_loader']
        // throw {msg: domain+ ' is loading'}
    }

}
async function scriptLoader(domain, ver){
    var url = buildUrl(domain, ver)
    // window[domain+'_loader'] = 
    await loadScript(url)
    //TODO error

    var container = window[domain] // or get the container somewhere else
    // Initialize the container, it may provide shared modules
    await container.init(__webpack_share_scopes__.default)
    var manifest = await getModule(domain, './manifest')

    ModuleCache[domain] = { ...manifest }
    if (manifest.typeLib) {
        var libMod = await getModule(domain, manifest.typeLib)
        for (var i in libMod) {
            TypeLib[i === 'default' ? domain : domain + '.' + i] = libMod[i]
        }
    }

    if (manifest.proxy) {
        var proxy = await getModule(domain, manifest.proxy)
        ModuleCache[domain].proxyModule = proxy.default
        return true
    }
    var loads = Object.keys(manifest.module).map((i)=>{
        var name = buildLibName(domain, i)
        ModuleCache[name] = ModuleCache[name] || getModule(domain, i)
        return ModuleCache[name]
    })
    await Promise.all(loads)
    // for (var i in manifest.module) {
    //     // var m = manifest.module[i]
    //     // if(Array.isArray(m)){}
    //     var name = buildLibName(domain, i)
    //     ModuleCache[name] = ModuleCache[name] || await getModule(domain, i)
    // }
}
var url ={
    // tmpl_core: 3001
    // , uiux_engine : 3002
    // , security_iRPM: 3003
    // , html : 3004
    // , tmpl_antd: 3005
    // , tmpl_site1: 3006
}
export function registerUrl(obj){
    url = obj
}
function buildUrl(domain, ver) {
    if(!url[domain]) throw {msg:`domain ${domain} is not register`}
    return url[domain]
}

function buildLibName(domain, tmpl) {
    var mod = tmpl.startsWith('./')?tmpl.substr(2):tmpl
    return `${domain}://${mod}`
}

async function getModule(domain, module) {
    var factory = await window[domain].get(module)
    var Module = factory()
    return Module
}
function parseName(name) {
    var parts = name.split('://')
        , domain = parts.length === 1 ? DEF : parts[0]
        , mod = parts.length < 3 ? 'default' : parts[2]
        , tmpl = parts.length === 1 ? parts[0] : parts[1]
    return {
        domain, tmpl, mod, name
    }
}

// function loadModule(domain, tmpl, mod) {
    // if(arguments.length===1){
    //     var {domain, tmpl, mod} = parseName(arguments[0])
    // }
function loadModule(uri) {
    var {domain, tmpl, mod} = parseName(uri)
    return async () => {
        var useProxy = await loadDomain(domain)
        var name = buildLibName(domain, tmpl)
        if (useProxy===true) {
            TmplCache[name] = ModuleCache[domain].proxyModule(tmpl)
            return TmplCache[name] 
        }
        if(!ModuleCache[name]){
            throw {
                message: name+ ' is not found, please check the name'
            }
        }
        var exported = ModuleCache[name][mod]
        if(!exported){
            throw {
                message: name+ ' is found, but the exported "'+mod+'" is not found, please check the name'
            }
        }
        if (mod === 'default') {
            TmplCache[name] = exported
        }
        else{
            TmplCache[name + '://' + mod] = exported
        }
        return exported
    }
}

// function Import(domain, module, mod) {
//     var libAsync = async () => await loadDomain(domain, module, mod)
//     var lib = libAsync()
//     return lib
// }
export async function Import(){
    try {
        return ImportThrow(...arguments)
    } catch (e) {
        // Deal with the fact the chain failed
    }
}
export async function ImportThrow(){
    var modFn = await loadModule(...arguments);
    var mod =  await modFn();
    return mod
}

var Loader
if(window.Loader) Loader = window.Loader
else Loader = window.Loader = {
    ModuleCache
    , TmplCache
    , TypeLib
    , loadModule
    , loadDomain
    , parseName
    , Import
    , ImportThrow
    , registerUrl
}

export default Loader

