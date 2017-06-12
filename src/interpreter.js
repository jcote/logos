const AST = require('./ast');
const DataLib = require('./datalib');

const AssociativeValueIncreaseFactor = 1;
const AssociativeValueDecreaseFactor = 0.5;

const isValue = node => node instanceof AST.Abstraction;
const isName = node => node instanceof AST.Identifier;
const isApp = node => node instanceof AST.Application;

// determines whether the abstraction (function to call) is accepting one more
// parameter, and the input given matches the expected type 
const typecheck = (abstraction, input) => {
  if (abstraction.type == 'free') {
    // we have a free variable with arbitrary code in .fn
    // or an ast in .astid (don't need to typecheck)
    if (abstraction.fn) {
      if (abstraction.argCount == 0) return false;
      if (abstraction.args) {
        // abstraction already has args. check if does not match 'next' arg
        var inputType = (input.type == 'free') ? typeof input.fn : input.type;
        if (abstraction.argTypes[abstraction.args.length] != inputType) return false;
      } else if (abstraction.argTypes[0] != typeof input) return false;
    }
  }
  return true;
}

// if astid is referenced in the given free identifier,
// retrieve it from the database
const getAstIfNeeded = (entity, cb) => {
  if (entity.type == 'free' && entity.astid) {
    DataLib.readById(entity.astid, (entity2) => {
      return cb(entity2)
    });
  } else {
    return cb(entity);
  }
}

const apply = (abstraction, input, lastAst, callback) => {
  console.log('### A1 ###');
  if (!typecheck(abstraction, input)) {
    // can't apply these two. return unchanged AST
    return callback(lastAst, false);
  }
  // create an application of the two entities
  getAstIfNeeded(abstraction, (abstractionPreAst) => {
    getAstIfNeeded(input, (inputPreAst) => {
      console.log('### A2 ###');
      DataLib.readOrCreateApplication(abstractionPreAst.id, inputPreAst.id, (application) => {
        var applicationAst = new AST.Application(abstractionPreAst, inputPreAst);
        return evaluate(applicationAst, (astOut) => {
          console.log('### A3 ###');
          // was able to apply. return changed AST
          return callback(astOut, true);
          // TODO: write associative value
        });
      });
    });
  });
}

const getXfromValue = (v) => {
  return (v * Math.E) / (1 - v);
}

const getValueFromX = (x) => {
  return x / (x + Math.E);
}

const getAdjustedAssociativeValue = (assv, success) => {
  var x = getXfromValue(assv);
  if (success) {
    x += AssociativeValueIncreaseFactor;
    return getValueFromX(x);
  } else {
    x -= AssociativeValueDecreaseFactor;
    return getValueFromX(x);
  }
}

const applyAndAdjustAssociativeValue = (data, input, lastAst, callback) => {
  console.log('*** AA1 ***');
  apply(data, input, lastAst, (astOut, success) => {
    console.log('*** AA2 ***');
    let oldAssv = data.assv;
    data.assv = getAdjustedAssociativeValue(data.assv, success);
    DataLib.update(data, function(written) {
      if (written) console.log('updated associative value ' + oldAssv + '->' + data.assv);
      if (!written) console.log('failed to update assv: ' + data.id);
      callback(astOut);
    });
  });
}

// higher level evaluator that combines together all of the 
// expression fragments in the database into a single set of
// possible evaluation points by use of associative value to 
// make selections. also writes associative values upon selection
// (substitution for a lambda combinator)
const combine = (lastAst) => {
  // TODO: get input
  DataLib.readByAssociativeValue((input) => {
    // TODO: run associative value selection math
    // see if lastAst is usable as an abstraction to apply to the input
    if (lastAst && (lastAst.type == 'abs' || (lastAst.type == 'free' && typeof lastAst.argCount === 'number' && lastAst.argCount > (lastAst.args.length)))) {
      console.log("*** C1 *** -> " + input.type);
      applyAndAdjustAssociativeValue(lastAst, input, lastAst, (astOut) => {
        setTimeout(combine, 1, astOut);
      });
    } else {
      // get a pseudo-random abstraction from diary
      DataLib.readAbstractionByAssociativeValue((abstraction) => {
        console.log("*** C2 *** -> " + abstraction.type + " : " + input.type);
        applyAndAdjustAssociativeValue(abstraction, input, lastAst, (astOut) => {
          setTimeout(combine, 1, astOut);
        });
      });
    }
  });
}

const getAst = (data, cb) => {
  if (data.type == 'abs') {
    DataLib.readById(data.def2, (dataBody) => {
      cb(new AST.Abstraction(data.name, dataBody));
    });
  } else if (data.type == 'app') {
    DataLib.readById(data.def1, (dataLhs) => {
      DataLib.readById(data.def2, (dataRhs) => {
        cb(new AST.Application(dataLhs, dataRhs));
      });
    });
  } else if (data.type == 'id') {
    cb(new AST.Identifier(data.indx));
  } else if (data.type == 'free') {
    if (entity.astid) {
      DataLib.readById(entity.astid, (entity2) => {
        getAst(entity2, cb); // TODO: catch possible infinite recursion
      });
    } else {
      var identifierAst = new AST.Identifier(
        entity.name, entity.astid, entity.fn, typeof entity.fn, entity.argCount, entity.argTypes);
      cb(identifierAst);
    }
  } else {
    console.log('*** GETAST UNKNOWN TYPE: ' + data.type);
  }
}

// evaluates the (extended) lambda calculus expression given
// and returns the reduced (extended) lambda calculus expression
// executing any complete applications of functional (JS) identifiers
// TODO: make turbo substitutions using EC
const evaluate = (ast, cb) => {
    if ('type' in ast) {
      return getAst(ast, (realAst) => {
        evaluate(realAst, cb);
      })
    }
    if (isApp(ast)) {
      /**
       * `ast` is an application
       */
      if (isValue(ast.lhs) && isValue(ast.rhs)) {
        console.log("### I 1 ###");
        /**
         * if both sides of the application are values we can proceed and
         * substitute the rhs value for the variables that reference the
         * abstraction's parameter in the evaluation body and then evaluate the
         * abstraction's body
         */
        substitute(ast.rhs, ast.lhs.body, function(ast2) {
          DataLib.createSubstitution("beta", ast.id, ast2.id, (substitution) => {
            evaluate(ast2, cb);
          });
        });
      } else if (isValue(ast.lhs)) {
        console.log("### I 2 ###");
        /**
         * We should only evaluate rhs once lhs has been reduced to a value
         */
        ast.rhs = evaluate(ast.rhs, cb);
      } else if (isName(ast.lhs) && ast.lhs.fn && ast.lhs.args.length < ast.lhs.argCount) {
        console.log("### I 3 ###");
        /**
         * lhs is a named function that requires 0 or more args
         */
        // curry in one more arg
        tryExtractArg(ast, (astOut) => {
          evaluate(astOut, cb);
        });
      } else {
        console.log("### I 4 ###");
        /**
         * Keep reducing lhs until it becomes a value
         */
        ast.lhs = evaluate(ast.lhs, (result) => {
          ast.lhs = result;
          evaluate(ast, cb);
        });
      }
    } else if (isValue(ast)) {
      console.log("### II ###");
      /**
       * * `ast` is a value, and therefore an abstraction. That means we're done
        * reducing it, and this is the result of the current evaluation.
        */
      return cb(ast);
    } else if (isName(ast)) {
      /**
       * `ast` is a named identifier / variable, and maybe a named function
       */
      if (ast.fn && ast.args.length == ast.argCount) {
        console.log("### III 1 ###");
        /**
         * lhs is a named function that has 0 or more args
         */
        // has enough args, execute
        if (typeof ast.fn == 'string') {
          ast.fn = eval(ast.fn);  // <= CODE EXECUTION
        }
        var output = ast.fn.apply(null, ast.args);  // <= CODE EXECUTION
        // substitute the named function with its output
        return cb(output);
        // TODO: write substitution to Diary
      } else {
        console.log("### III 2 ###");
        // `ast` is an named identifier / variable and not a named funciton
        return cb(ast);        
      }
    } else {
      console.log('### UNKNOWN TYPE ### ' + typeof ast + ' ' + ast.type);
    }
};

/**
 * when given an ast with lhs a named function which requires at least one more arg,
 * searches rhs for matching expected arg type.
 */
const tryExtractArg = (ast, cb) => {
  // expected arg type is either a JS type or "ast"
  var expectedArgType = ast.lhs.argTypes[ast.lhs.args.length];
  // fn attribute of identifier is js code
  if (ast.rhs.fn && typeof ast.rhs.fn == expectedArgType) {
    console.log("### A ###");
    ast.lhs.args = ast.lhs.args.concat(ast.rhs.fn);
    return cb(ast.lhs);
  } else if (expectedArgType == "ast") {
    console.log("### B ###");
    // if rhs is an identifier with embedded ast expression, use that
    if (isName(ast.rhs) && ast.rhs.astid) {
      ast.lhs.args = ast.lhs.args.concat(ast.rhs.astid);
    } else {
      // rhs is itself an ast expression
      ast.lhs.args = ast.lhs.args.concat(ast.rhs);
    }
    return cb(ast.lhs);
  } else {
    console.log("### C ###");
    // rhs is not expected arg type
    // evaluate rhs (once) and try again
    evaluate(ast.rhs, (astRight) => {
      ast.rhs = astRight;
      tryExtractArg(ast, (astOut) => {
        return cb(astOut);
      });
    });
  }
}

const traverse = fn =>
  function(node, ...args) {
    const config = fn(...args);
    if (node instanceof AST.Application)
      return config.Application(node);
    else if (node instanceof AST.Abstraction)
      return config.Abstraction(node);
    else if (node instanceof AST.Identifier)
      return config.Identifier(node);
  }

const shift = (by, node, cb) => {
  const aux = traverse((from, cb2) => ({
    Application(app) {
      aux(app.lhs, from, function(node1){
        aux(app.rhs, from, function(node2) {
          var applicationAst = new AST.Application(
            node1,
            node2
          );
          DataLib.readOrCreateApplication(app.lhs.id, app.rhs.id, (application) => {
            applicationAst.id = application.id;
            return cb2(applicationAst);
          });
        });
      });
    },
    Abstraction(abs) {
      aux(abs.body, from + 1, function(node1) {
        var abstractionAst = new AST.Abstraction(
          abs.param,
          node1
        );
        DataLib.readOrCreateAbstraction(abs.param, abs.body.id, (abstraction) => {
          abstractionAst.id = abstraction.id;
          return cb2(abstractionAst);
        });
      });
    },
    Identifier(id) {
      if (typeof id.value === 'number') {
        var identifierAst = new AST.Identifier(
          id.value + (id.value >= from ? by : 0)
        );
        DataLib.readOrCreateIdentifier(id.value, (identifier) => {
          identifierAst.id = identifier.id;
          return cb2(identifierAst);
        });
      } else {
        DataLib.readOrCreateFreeIdentifier(id.value, (identifier) => {
          var identifierAst = new AST.Identifier(
            identifier.name, identifier.astid, identifier.fn, typeof identifier.fn, identifier.argCount, identifier.argTypes);
          identifierAst.id = identifier.id;
          return cb2(identifierAst);
        });
      }
    }
  }));
  aux(node, 0, function(node1) {
    return cb(node1);    
  });
};

const subst = (value, node, cb) => {
  const aux = traverse((depth,cb2) => ({
    Application(app) {
      aux(app.lhs, depth, function(node1){
        aux(app.rhs, depth, function(node2) {
          var applicationAst = new AST.Application(
            node1,
            node2
          );
          DataLib.readOrCreateApplication(app.lhs.id, app.rhs.id, (application) => {
            applicationAst.id = application.id;
            return cb2(applicationAst);
          });
        });
      });
    },
    Abstraction(abs) {
      aux(abs.body, depth + 1, function(node1) {
        var abstractionAst = new AST.Abstraction(
          abs.param,
          node1
        );
        DataLib.readOrCreateAbstraction(abs.param, abs.body.id, (abstraction) => {
          abstractionAst.id = abstraction.id;
          return cb2(abstractionAst);
        });
      });
    },
    Identifier(id) {
      if (depth === id.value)
        return shift(depth, value, function(result) {
          cb2(result);
        });
      else
        return cb2(id);
    }
  }));
  aux(node, 0, function(node1) {
    return cb(node1);    
  });
};

const substitute = (value, node, cb) => {
  shift(1, value, function(node1){
    subst(node1, node, function(node2){
      shift(-1, node2, function(node3){
        return cb (node3);
      });
    })    
  })
};

exports.evaluate = evaluate;
exports.combine = combine;
