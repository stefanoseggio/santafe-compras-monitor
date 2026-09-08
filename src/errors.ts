export class InputError extends Error {
    constructor(message: string) {
        super(`Invalid input: ${message}`);
        this.name = 'InputError';
    }
}
