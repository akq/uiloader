const extractUrlAndGlobal = require("webpack/lib/util/extractUrlAndGlobal");
const { RawSource } = require("webpack-sources");
const RemoteModule = require("webpack/lib/container/RemoteModule");
const RemoteToExternalDependency = require("webpack/lib/container/RemoteToExternalDependency");
const FallbackItemDependency = require("webpack/lib/container/FallbackItemDependency");
const FallbackDependency = require("webpack/lib/container/FallbackDependency");
const FallbackModuleFactory = require("webpack/lib/container/FallbackModuleFactory");
const { RuntimeGlobals } = require("webpack");
const RemoteRuntimeModule = require("webpack/lib/container/RemoteRuntimeModule");
const ExternalModuleFactoryPlugin = require("webpack/lib/ExternalModuleFactoryPlugin");
const ModuleFederationPlugin = require("webpack/lib/container/ModuleFederationPlugin");

const PLUGIN_NAME = "UiuxLoaderPlugin";

function checkReq(data, cb) {
  var req = data.request
  if (~req.indexOf("://")) {
    var [domain, mod, scope = 'default'] = req.split('://')
    if (checkDomain(domain)) {
      var ref = 'webpack/container/reference/' + domain
      return cb(req, ref, { domain, mod, scope })
    }
  }
}

function checkDomain(domain){
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(domain) && domain !== 'http' && domain !== 'https'
}
class UiuxLoaderPlugin {
  constructor(options={}) {
    var {remotes, shared: sh,  manifest = {}, filename, ...opts} = options
    var {name, module} = manifest
    var shared
    switch(typeof sh){
      case 'string':
        shared = sh.split(',').reduce((a,c)=>{a[c.trim()]={singleton: true}; return a;}, {})
        break
      case 'array':
        shared = sh.reduce((a,c)=>{a[c.trim()]={singleton: true, import: false}; return a;}, {})
        break
      default: 
        shared = sh  
    } 
    if(module)
      this.mfOption = {
        name: '$$'+name, exposes: module, filename:'remoteEntry.js', shared, ...opts
      }
    this.manifest = manifest
	}

  apply(compiler) {
    if(this.mfOption) new ModuleFederationPlugin(this.mfOption).apply(compiler)
    var loaderAdded = false
    compiler.hooks.compile.tap(PLUGIN_NAME, ({ normalModuleFactory }) => {
      normalModuleFactory.hooks.factorize.tap(
        PLUGIN_NAME,
        data => {
          return checkReq(data,
            (req, ref, { domain }) =>{
              new ExternalModuleFactoryPlugin('script', {[ref]: domain+ '@' +req}).apply(
                normalModuleFactory
              );
            }
          )
        })
    })

    compiler.hooks.compilation.tap(
      PLUGIN_NAME,
      (compilation, { normalModuleFactory }) => {
        compilation.dependencyFactories.set(
          RemoteToExternalDependency,
          normalModuleFactory
        );

        compilation.dependencyFactories.set(
          FallbackItemDependency,
          normalModuleFactory
        );

        compilation.dependencyFactories.set(
          FallbackDependency,
          new FallbackModuleFactory()
        );

        normalModuleFactory.hooks.factorize.tap(
          PLUGIN_NAME,
          data => {
            return checkReq(data,
              (req, ref, { domain, mod, scope }) => new RemoteModule(
                [domain, mod].join('/'),
                [ref],
                './' + mod,
                scope)
            )
          }
        )
      }
    )
    var manifest = this.manifest
    compiler.hooks.make.tap(PLUGIN_NAME, (compilation) => {

      const scriptExternalModules = [];
      const entryModules = [];
      compilation.hooks.buildModule.tap(PLUGIN_NAME, (module) => {
        if (
          module.constructor.name === "ExternalModule" &&
          module.externalType === "script"
        ) {
          scriptExternalModules.push(module);
        }
        if(module.constructor.name === 'ContainerEntryModule'){
          entryModules.push(module)
        }      
      });


      compilation.hooks.afterCodeGeneration.tap(PLUGIN_NAME, function () {
        scriptExternalModules.map((module) => {
          const domain = extractUrlAndGlobal(module.request)[1];
          if(!checkDomain(domain)) return
          const sourceMap =
            compilation.codeGenerationResults.get(module).sources;
          // const rawSource = sourceMap.get("javascript");
          sourceMap.set(
            "javascript",
            new RawSource(
              loaderAdded? 
`var __webpack_error__ = new Error();
module.exports = __webpack_modules__.__loader__("${domain}", __webpack_require__, __webpack_error__)`
:
`var __webpack_error__ = new Error();
module.exports = __webpack_modules__.__loader__("${domain}", __webpack_require__, __webpack_error__);
/***/ })
, __loader__: ((name, __webpack_require__, __webpack_error__) =>{ 
	window.__loader__ = window.__loader__ || ((name) => new Promise((resolve, reject) => {
		if(typeof window['$$'+name] !== "undefined") return resolve();
		__webpack_require__.l((window.__URLS__?.[name] || (console.log('name '+name + ' is not found'), '')) + "/remoteEntry.js", (event) => {
			if(typeof window['$$'+name] !== "undefined") return resolve();
      window['$$'+name]={
        get:(mod)=>()=>({default: name+'://'+mod+' not found'})
        , init:()=>null/*{throw {message: name+'://'+mod+' not found'}}*/
      }
      resolve()
		}, name);
	}).then(() => (window['$$'+name])));
  window.__tmpl_cache__ = window.__tmpl_cache__ || {}
  window.__uiux_import__ = window.__uiux_import__ || (async (uri)=>{
    var [domain, mod, scope='default'] = uri.split('://')
    if(domain && mod){
        if(window.__tmpl_cache__[uri]) return Promise.resolve({default: window.__tmpl_cache__[uri]})
        await window.__loader__(domain)
        var container = window['$$'+domain]
        if(container && container.init){
          await container.init(__webpack_require__.S.default)
        }
        else{
          throw {
            message: 'domain name "' + domain+ '" doesn\\'t have the init method'
          }
        }
        var {proxy, module: mods} = container.manifest
        var mod1 = './'+mod, scope1 = scope
        var useProxy = proxy && !mods[mod1]
        if(useProxy){ 
          var [pMod, pScope='default'] = proxy.split('://')
          mod1 = pMod.startsWith('./')? pMod: './'+pMod
          scope1 = pScope
        }
        var factory = await container.get(mod1)
        var module = factory()
        var exp = module[scope1]
        if(exp){
          window.__tmpl_cache__[uri] = useProxy?exp(mod, scope):exp
          return Promise.resolve({default:window.__tmpl_cache__[uri] })
        }
        throw {
          message: domain+'://'+mod + ' is found, but the exported "'+scope+'" is not found, please check the name'
        }
    }
    else{
        throw {
          message: 'The name '+ uri +' is not corrected, please use the format domain://module or domain://module://scope'
        }
    }
  })

	return window.__loader__(name);
`
              // rawSource.source().replace(`"${urlTemplate}"`, urlExpression)
            )
          );
          if(!loaderAdded) loaderAdded = true
        });

        entryModules.map((module) => {
          const sourceMap =
            compilation.codeGenerationResults.get(module).sources;
          const rawSource = sourceMap.get("javascript");
          var src = rawSource.source()
          var len1 = src.lastIndexOf('//')
          var len2 = src.lastIndexOf('\n')

          var {typeLib:lib} = manifest
          src = src.substring(0, len1) 
            + `\n var manifest = ${JSON.stringify(manifest, null, 2)};\n`
            + `\n var typeLib;\n`
            + src.substring(len1, len2)
            + `, \n\tmanifest: ()=>(manifest)`
            + (lib ? `, \n\tgetTypeLib: ()=>(async()=>{
              if(typeLib) return typeLib
              var factory = await get("${lib}")
              var mod = factory()
              typeLib = mod
              return typeLib
            }),\n\ttypeLib: ()=>(typeLib)`:'')
            + src.substring(len2)
          // debugger
          sourceMap.set(
            "javascript",
            new RawSource(
              src
            )
          )         

        })
      });

      compilation.hooks.runtimeRequirementInTree
      .for(RuntimeGlobals.ensureChunkHandlers)
      .tap("ContainerReferencePlugin", (chunk, set) => {
        set.add(RuntimeGlobals.module);
        set.add(RuntimeGlobals.moduleFactoriesAddOnly);
        set.add(RuntimeGlobals.hasOwnProperty);
        set.add(RuntimeGlobals.initializeSharing);
        set.add(RuntimeGlobals.shareScopeMap);
        compilation.addRuntimeModule(chunk, new RemoteRuntimeModule());
      });
    });
  }
}

module.exports = UiuxLoaderPlugin;
