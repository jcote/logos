'use strict';
const async = require("async");
const DataLib = require('./datalib');
const F = require('./function');
const Q = require('q');
const Diary = require('./diary');



// TODO: use node vm



// context for evaluating the function body
const contextClosure = function(str, argTypes, args, modules) {
	var requires = '';
	for (var i = 0; i < modules.length; i++) {
		var module = modules[i];
		requires += `const ${module.name} = require('${module.path}');
								`;
	}

	const CTX = {
		args: {}
	};

  if (args != null) {
		for (var i = 0; i < argTypes.length; i++) {
			var argName = argTypes[i][0];
			var argType = argTypes[i][1];
			CTX.args[argName] = args[i];
		}
	}

  console.log("!!!!!!!!!!!!!!CODE EXECUTION!!!!!!!!!!!\n"+requires+str+"\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  const output = eval(requires + str);            // <=== CODE EXECUTION
  console.log("!!!!!!!!!!!!!!OUTPUT!!!!!!!!!!!\n"+output+"\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  return output;
}

// retrieves all the modules given storedFunction's module array
function loadModules (moduleNames, cb) {
	if (moduleNames == null || moduleNames.length == 0) {
		return cb(null, []);
	}
	async.map(moduleNames, (moduleName, callback) => {
		DataLib.readModuleByName(moduleName, (module) => {
			if (module == null) {
				return callback('Invalid module \'' + moduleName + '\'');
			}
			return callback(null, module);
		});
	}, (err, results) => {
		if (err) {
			return cb(err, []);
		}

		cb(null, results);
	});
}

function loadStoredFunction(freeIdentifier) {
	if ('argTypes' in freeIdentifier) {
		// have ast version
		var storedFunction = new F.StoredFunction(
			freeIdentifier.memo, 
			freeIdentifier.fntype, 
			freeIdentifier.fnclas, 
			freeIdentifier.argTypes, 
			freeIdentifier.mods, 
			freeIdentifier.fn);
		return storedFunction;
	}
	// straight from db
	var storedFunction = new F.StoredFunction(freeIdentifier.memo, freeIdentifier.fntype, freeIdentifier.fnclas, freeIdentifier.argt, freeIdentifier.mods, freeIdentifier.fn);
	return storedFunction; 
}

/* parse the given function for consistency and correctness
 *
 * note: if argTypes is null this is a stored value (a function has empty array [] for argTypes)
 *       in this case we can still evaluate the functionbody to match its type & class
 *       (the last line is the returned value of an eval)
 *
 * returns null on success, error message on failure
*/
function parseFunction (storedFunction, args, cb) {
	if (!(storedFunction instanceof F.StoredFunction)) {
		return cb('Must be instance of StoredFunction');
	}

 var type = new String(storedFunction.type);

  loadModules(storedFunction.modules, (err, modulePaths) => {
		if (err) {
			return cb("Module error: " + err  + JSON.stringify(storedFunction));
		}
  	checkArgs(storedFunction.argTypes, args, (err2) => {
  		if (err2) {
  			return cb("Check argument error: " + err2  + JSON.stringify(storedFunction));
  		}

			if (storedFunction.functionBody == null) {
				// this is an extensional function (defined by substitutions) or maybe a plain free identifier ended up here
				return cb(null);
			}

		  var result;
			try {
				result = contextClosure.call(null, storedFunction.functionBody, storedFunction.argTypes, args, modulePaths);   // <=== CODE EXECUTION
			} catch (e) {
		    if (e instanceof SyntaxError) {
		      return cb(`SyntaxError on line ${e.lineNumber}: ${e.message}` + JSON.stringify(storedFunction), e);
		    }

		    return cb(`${e.constructor.name} error on line ${extractLineNumberFromStack(e.stack)}: ${e.message}` + JSON.stringify(storedFunction), e);
			}

	    if (type == 'promise') {
	    	if (isPromise(result)) {
	    		return cb(`storedFunction is of class ${result.constructor.name} and not a promise: ` + JSON.stringify(storedFunction));
	    	}
	    	return cb(null); // return ok since we cannot verify promise return type (fnclass)
	    } else if (typeof result === type) {
	    	if (type === 'undefined') type = undefined;
		    return cb(`storedFunction is type '${typeof result}' and not '${type}'` + JSON.stringify(storedFunction));
		  }

		  if (typeof result === 'object') {
		  	return checkClass(result, storedFunction.klass, (err3) => {
		  		if (err3) {
		  			return cb(err + JSON.stringify(storedFunction));
		  		}
		  		return cb(null);
		  	});
	    } else {
	   	  return cb(null);
	    }
	  });
  });
}

function executeFunction(storedFunction, args, cb) {
	if (!(storedFunction instanceof F.StoredFunction)) {
		console.error('executeFunction -> Must be instance of StoredFunction');
		return cb(null);
	}

  loadModules(storedFunction.modules, (err, modulePaths) => {
  	if (err) {
  		console.error("ExecuteFunction module error: " + err  + JSON.stringify(storedFunction));
  		return cb(null);
  	}
  	checkArgs(storedFunction.argTypes, args, (err2) => {
  		if (err) {
  			console.error("ExecuteFunction args error: " + err2  + JSON.stringify(storedFunction));
  			return cb(null);
  		}

		  var result;
			try {
				result = contextClosure.call(null, storedFunction.functionBody, storedFunction.argTypes, args, modulePaths);   // <=== CODE EXECUTION
				return cb(result);
			} catch (e) {
		    if (e instanceof SyntaxError) {
		      console.error(`executeFunction -> SyntaxError on line ${extractLineNumberFromStack(e.stack)}: ${e.message}` + JSON.stringify(storedFunction), e);
		    }

		    console.error(`executeFunction -> ${e.constructor.name} error on line ${e.lineNumber}: ${e.message}` + JSON.stringify(storedFunction), e);
		    cb(null);
			}
  	});
	});
}

function checkClass(testObject, className, cb) {
	if (testObject == null || typeof testObject != 'object') return cb(null);
  DataLib.readClassByName(className, (klass) => {
  	if (klass == null) {
  		return cb(`class name '${className}' is not found in the database`);
  	}

  	DataLib.readModuleByName(klass.module, (mod) => {
    	if (mod == null) {
    		return cb(`class '${klass.name}' belongs to module '${klass.module}' which is not found in the database`);
    	}

// in case this doesnt work because the file is loaded separately from sensei's even though it is the same source file (AST)
//			if (testObject.constructor.name != klass.name) {
  		if (!(eval('const '+mod.name+' = require(\''+mod.path+'\');\
								  testObject instanceof '+mod.name+'.'+klass.name))) {   // <=== CODE EXECUTION
  			return cb('object is class "'+testObject.constructor.name+'" and not "'+mod.name+'.'+klass.name+'"');
  	  }

  	  return cb(null);
    });
  });
}

// match each of args with its respective argType which specifies the 
// colloquial name, the type and optionally the class name
// verify these for consistency in parallel
// if class name is specified then code execution occurs
function checkArgs(argTypes, args, cb) {
	if (!Array.isArray(argTypes)) {
		if (!Array.isArray(args)) {
		  return cb(null);
	  }
		if (args.length > 0) {
			return cb("More args than argTypes");
		}
		return cb(null);
	} 
	if (argTypes.length > args.length) {
		return cb("More argTypes than args");
	}
	if (argTypes.length < args.length) {
		return cb("More args than argTypes");
	}

	async.eachOf(args, (arg, i, callback) => {
		if (!Array.isArray(argTypes[i]) || argTypes[i].length < 2) {
			return callback("Argtype #" + i + " is not of length >= 2 specifying name and type (& class)" + JSON.stringify(argTypes));
		}
		var argName = argTypes[i][0];
		var argType = argTypes[i][1];
		var argClass = (argTypes[i].length > 2) ? argTypes[i][2] : null;

	  if (argType == 'promise' && !isPromise(arg)) {
		  return callback("Arg " + argName+ " `" + arg + "` is not promise");
		}
		if (typeof arg != argType && typeof arg != 'object') {
			return callback("Arg " + argName+ " `" + arg + "` is type `" + typeof arg + "` and not `" + argType + "`");
		}
    if (argClass) {
		  checkClass(arg, argClass, (err) => {
		  	return callback(err);
		  });
    } else {
    	return callback(null);
    }
  }, (err) => {
  	return cb(err);
  });
}

function extractLineNumberFromStack (stack) {
  if(!stack) return '?'; // fix undefined issue reported by @sigod

	var caller_line = stack.split("\n")[1];
	var index = caller_line.indexOf(",") + 14; // ` <anonymous>:`
	var clean = caller_line.slice(index, caller_line.length - 1);

  return clean;
}

function isPromise(obj) {
  return Promise.resolve(obj) == obj;
}

module.exports = {
	loadStoredFunction: loadStoredFunction,
	parseFunction: parseFunction,
	executeFunction: executeFunction
};