export class InputError extends Error {
    constructor(message) {
        super(`Invalid input: ${message}`);
        this.name = 'InputError';
    }
}
//# sourceMappingURL=errors.js.map