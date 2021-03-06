import {Keyboard} from "keysim";

import {ONE_SECOND_MS} from "src/shared/constants";
import {asyncDelay, curryFunctionMembers} from "src/shared/util";
import {buildLoggerBundle} from "src/electron-preload/util";

export const waitElements = <E extends Element,
    Q extends Readonly<Record<string, () => E>>,
    K extends keyof Q,
    R extends { [key in K]: ReturnType<Q[key]> }>(
    query: Q,
    opts: { timeoutMs?: number, iterationsLimit?: number } = {},
): Promise<Readonly<R>> => new Promise((resolve, reject) => {
    const OPTS = {
        timeoutMs: opts.timeoutMs || ONE_SECOND_MS * 10,
        iterationsLimit: opts.iterationsLimit || 0, // 0 - unlimited
        delayMinMs: 300,
    };
    const startTime = Number(new Date());
    const delayMs = OPTS.timeoutMs / 50;
    const queryKeys: K[] = Object.keys(query) as K[];
    const resolvedElements: Partial<R> = {};
    let iteration = 0;

    scanElements();

    function scanElements() {
        iteration++;

        queryKeys.forEach((key) => {
            if (key in resolvedElements) {
                return;
            }
            const element = query[key]();
            if (element) {
                resolvedElements[key] = element as any;
            }
        });

        if (Object.keys(resolvedElements).length === queryKeys.length) {
            return resolve(resolvedElements as R);
        }

        if (OPTS.iterationsLimit && (iteration >= OPTS.iterationsLimit)) {
            return reject(new Error(
                `Failed to resolve some DOM elements from the list [${queryKeys.join(", ")}] having "${iteration}" iterations performed`,
            ));
        }

        if (Number(new Date()) - startTime > OPTS.timeoutMs) {
            return reject(new Error(
                `Failed to resolve some DOM elements from the list [${queryKeys.join(", ")}] within "${OPTS.timeoutMs}" milliseconds`,
            ));
        }

        setTimeout(scanElements, Math.max(OPTS.delayMinMs, delayMs));
    }
});

export function getLocationHref(): string {
    return (window as any).location.href;
}

export async function fillInputValue(input: HTMLInputElement, value: string) {
    input.value = value;
    Keyboard.US_ENGLISH.dispatchEventsForInput(value, input);
}

export async function submitTotpToken(
    input: HTMLInputElement,
    button: HTMLElement,
    tokenResolver: () => string,
    _logger: ReturnType<typeof buildLoggerBundle>,
): Promise<null> {
    const logger = curryFunctionMembers(_logger, "submitTotpToken()");
    logger.info();

    const submitTimeoutMs = ONE_SECOND_MS * 4;
    const newTokenDelayMs = ONE_SECOND_MS * 2;

    if (input.value) {
        throw new Error("2FA TOTP token is not supposed to be pre-filled on this stage");
    }

    const errorMessage = `Failed to submit two factor token within ${submitTimeoutMs}ms`;

    try {
        await submit();
    } catch (e) {
        if (e.message !== errorMessage) {
            throw e;
        }

        logger.verbose(`submit 1 - fail: ${e.message}`);
        // second attempt as token might become expired right before submitting
        await asyncDelay(newTokenDelayMs, submit);
    }

    return null;

    async function submit() {
        logger.verbose("submit - start");
        const urlBeforeSubmit = getLocationHref();

        await fillInputValue(input, tokenResolver());
        logger.verbose("input filled");

        button.click();
        logger.verbose("clicked");

        await asyncDelay(submitTimeoutMs);

        if (getLocationHref() === urlBeforeSubmit) {
            throw new Error(errorMessage);
        }

        logger.verbose("submit - success");
    }
}
