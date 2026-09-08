import { describe, expect, it } from 'vitest';

import {
    decodeSeen,
    emptyState,
    encodeSeen,
    isColdState,
    markSeen,
    pruneState,
    recordWalkCoverage,
} from '../src/state.js';

describe('delta state v2', () => {
    it('encodes estado + fingerprint per id and decodes legacy/unknown values safely', () => {
        expect(encodeSeen('AP', 'abc')).toBe('AP|abc');
        expect(decodeSeen('ET|')).toEqual({ estado: 'ET', hash: '' });
        expect(decodeSeen('XX|h')).toEqual({ estado: null, hash: 'h' });
        expect(decodeSeen('')).toEqual({ estado: null, hash: '' });
        expect(decodeSeen(undefined)).toBeNull();
    });

    it('tracks the highest delivered id as the watermark', () => {
        const state = emptyState('sig');
        expect(isColdState(state)).toBe(true);
        markSeen(state, '139000', 'AP', 'h1');
        markSeen(state, '138000', 'CO', '');
        expect(state.watermark).toBe(139000);
        expect(state.seen).toEqual({ '139000': 'AP|h1', '138000': 'CO|' });
        expect(isColdState(state)).toBe(false);
    });

    it('cold truncated run sets the baseline floor; a non-cold truncated run sets the backlog floor; a complete walk clears it', () => {
        const state = emptyState('sig');
        recordWalkCoverage(state, true, true, 138900);
        expect(state.baselineFloor).toBe(138900);
        expect(state.backlogFloor).toBeNull();

        recordWalkCoverage(state, false, true, 138500);
        expect(state.backlogFloor).toBe(138500);
        recordWalkCoverage(state, false, true, 138700); // a shallower truncated walk never raises the floor
        expect(state.backlogFloor).toBe(138500);
        recordWalkCoverage(state, false, false, null);
        expect(state.backlogFloor).toBeNull();
        expect(state.baselineFloor).toBe(138900); // the baseline survives - only resetState clears it

        const untruncatedCold = emptyState('sig');
        recordWalkCoverage(untruncatedCold, true, false, 100);
        expect(untruncatedCold.baselineFloor).toBeNull();
    });

    it('prunes the lowest (oldest) ids first', () => {
        const state = emptyState('sig');
        for (const id of ['5', '300', '42', '7', '1000']) markSeen(state, id, 'CO', '');
        pruneState(state, 3);
        expect(Object.keys(state.seen).sort()).toEqual(['1000', '300', '42']);
    });
});
