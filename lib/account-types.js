// src/account-types.ts
function failureDetails(value) {
	return value !== null && typeof value === "object" ? value : new Error(String(value));
}
export { failureDetails };

//# sourceMappingURL=account-types.js.map