import { describe, expect, it } from "vitest";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@bb/domain";
import type { HostDaemonInteractiveRequestResponse } from "@bb/host-daemon-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError,
} from "./interactive-request-registry.js";

interface CreateRegistryArgs {
  registerRequest: (
    request: PendingInteractionCreate,
  ) => Promise<HostDaemonInteractiveRequestResponse>;
}

interface CreateCommandApprovalRequestArgs {
  providerRequestId?: string;
}

function createCommandApprovalRequest(
  args: CreateCommandApprovalRequestArgs = {},
): PendingInteractionCreate {
  return {
    threadId: "thr_registry",
    turnId: "turn_registry",
    providerId: "codex",
    providerThreadId: "provider-thread-registry",
    providerRequestId: args.providerRequestId ?? "request-registry",
    payload: {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item-registry",
        command: "git push",
        cwd: "/tmp/project",
        actions: [],
        sessionGrant: null,
      },
      reason: "Needs approval",
      availableDecisions: ["allow_once", "deny"],
    },
  };
}

function createCommandApprovalResolution(): PendingInteractionResolution {
  return {
    decision: "allow_once",
    grantedPermissions: null,
  };
}

function createRegistry(args: CreateRegistryArgs): InteractiveRequestRegistry {
  return new InteractiveRequestRegistry({
    registerRequest: args.registerRequest,
  });
}

describe("InteractiveRequestRegistry", () => {
  it.each([true, false])(
    "waits for provider acknowledgement before completing delivery (accepted=%s)",
    async (accepted) => {
      const request = createCommandApprovalRequest();
      const receipt = createDeferredPromise<void>();
      const resolution = createCommandApprovalResolution();
      let attempts = 0;
      const registry = createRegistry({
        registerRequest: async () => ({
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        }),
      });
      const pending = registry.registerAndWait(request, {
        signal: new AbortController().signal,
        deliverResolution: async () => {
          attempts += 1;
          await receipt.promise;
        },
      });
      const pendingOutcome = pending.catch((error: unknown) => error);
      await Promise.resolve();
      const command = {
        ...request,
        interactionId: "pint_registry",
        resolution,
      };
      let finished = false;
      const delivery = registry.resolve(command);
      void delivery.then(
        () => {
          finished = true;
        },
        () => {},
      );
      expect(registry.resolve(command)).toBe(delivery);
      expect(attempts).toBe(1);
      expect(finished).toBe(false);
      if (accepted) {
        receipt.resolve();
        await delivery;
        expect(finished).toBe(true);
        await expect(pendingOutcome).resolves.toEqual(resolution);
        await registry.resolve(command);
        expect(attempts).toBe(1);
        const restarted = createRegistry({
          registerRequest: async () => ({
            outcome: "created",
            interactionId: "pint_registry",
            status: "pending",
          }),
        });
        expect(() => restarted.resolve(command)).toThrow("no longer awaiting");
        expect(attempts).toBe(1);
      } else {
        receipt.reject(new Error("Question cancelled"));
        await expect(delivery).rejects.toThrow("Question cancelled");
        await expect(pendingOutcome).resolves.toBeInstanceOf(Error);
        expect(() => registry.resolve(command)).toThrow("no longer awaiting");
      }
    },
  );

  it.each([true, false])(
    "propagates cancellation that races with registration (already cancelled=%s)",
    async (alreadyCancelled) => {
      const registration =
        createDeferredPromise<HostDaemonInteractiveRequestResponse>();
      const cancelled: PendingInteractionCreate[] = [];
      const controller = new AbortController();
      const request = createCommandApprovalRequest();
      const registry = new InteractiveRequestRegistry({
        registerRequest: async () => registration.promise,
        onCancellation: (request) => cancelled.push(request),
      });
      if (alreadyCancelled) controller.abort();
      const pending = registry.registerAndWait(request, {
        signal: controller.signal,
        deliverResolution: async () => {},
      });
      const outcome = pending.catch((error: unknown) => error);
      controller.abort();
      registration.resolve({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      });
      await expect(outcome).resolves.toBeInstanceOf(
        InteractiveRequestRegistryError,
      );
      expect(cancelled).toEqual([request]);
      expect(() =>
        registry.resolve({
          ...request,
          interactionId: "pint_registry",
          resolution: createCommandApprovalResolution(),
        }),
      ).toThrow("no longer awaiting");
    },
  );

  it("uses the delivery receipt when cancellation and registration race with an answer", async () => {
    const registration =
      createDeferredPromise<HostDaemonInteractiveRequestResponse>();
    const receipt = createDeferredPromise<void>();
    const cancelled: PendingInteractionCreate[] = [];
    const controller = new AbortController();
    const request = createCommandApprovalRequest();
    const resolution = createCommandApprovalResolution();
    const registry = new InteractiveRequestRegistry({
      registerRequest: async () => registration.promise,
      onCancellation: (request) => cancelled.push(request),
    });
    const pending = registry.registerAndWait(request, {
      signal: controller.signal,
      deliverResolution: async () => receipt.promise,
    });
    const delivery = registry.resolve({
      ...request,
      interactionId: "pint_registry",
      resolution,
    });
    controller.abort();
    registration.resolve({
      outcome: "created",
      interactionId: "pint_registry",
      status: "pending",
    });
    await Promise.resolve();
    expect(cancelled).toEqual([]);
    receipt.resolve();
    await delivery;
    await expect(pending).resolves.toEqual(resolution);
  });

  it("deduplicates registration retries for the same live provider request", async () => {
    const request = createCommandApprovalRequest();
    const registration =
      createDeferredPromise<HostDaemonInteractiveRequestResponse>();
    const registrations: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async (registeredRequest) => {
        registrations.push(registeredRequest);
        return registration.promise;
      },
    });

    const first = registry.registerAndWait(request);
    const second = registry.registerAndWait(request);

    expect(registrations).toEqual([request]);
    registration.resolve({
      outcome: "created",
      interactionId: "pint_registry",
      status: "pending",
    });

    const resolution = createCommandApprovalResolution();
    registry.resolve({
      interactionId: "pint_registry",
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId,
    });

    await expect(first).resolves.toEqual(resolution);
    await expect(second).resolves.toEqual(resolution);
  });

  it("ignores duplicate delivery after a command acknowledgement is retried", async () => {
    const request = createCommandApprovalRequest();
    const resolution = createCommandApprovalResolution();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      }),
    });

    const pending = registry.registerAndWait(request);
    const command = {
      interactionId: "pint_registry",
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId,
    };
    registry.resolve(command);
    registry.resolve(command);

    await expect(pending).resolves.toEqual(resolution);
  });

  it("rejects stale resolve commands that have no live provider request", () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      }),
    });

    expect(() =>
      registry.resolve({
        interactionId: "pint_registry",
        providerId: request.providerId,
        providerRequestId: request.providerRequestId,
        providerThreadId: request.providerThreadId,
        resolution: createCommandApprovalResolution(),
        threadId: request.threadId,
      }),
    ).toThrowError(InteractiveRequestRegistryError);
  });

  it("rejects provider waits when server registration is rejected", async () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "rejected",
        reason: "Thread is already awaiting user interaction",
      }),
    });

    await expect(registry.registerAndWait(request)).rejects.toMatchObject({
      code: "interactive_request_rejected",
      message: "Thread is already awaiting user interaction",
      name: "InteractiveRequestRegistryError",
    });
  });

  it("rejects provider waits when the provider exits", async () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      }),
    });

    const pending = registry.registerAndWait(request);
    registry.interruptThreads({
      providerId: request.providerId,
      reason: "Provider exited",
      threadIds: [request.threadId],
    });

    await expect(pending).rejects.toThrow("Provider exited");
  });
});
