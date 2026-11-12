import { Nt as filter, W as raceWith, cr as __spreadArray, et as not, fn as argsOrArgArray, sr as __read } from "./zipWith-DraVIeHl.js";
//#region node_modules/rxjs/dist/esm5/internal/operators/partition.js
function partition(predicate, thisArg) {
	return function(source) {
		return [filter(predicate, thisArg)(source), filter(not(predicate, thisArg))(source)];
	};
}
//#endregion
//#region node_modules/rxjs/dist/esm5/internal/operators/race.js
function race() {
	var args = [];
	for (var _i = 0; _i < arguments.length; _i++) args[_i] = arguments[_i];
	return raceWith.apply(void 0, __spreadArray([], __read(argsOrArgArray(args))));
}
//#endregion
export { partition as n, race as t };
