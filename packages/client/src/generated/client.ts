import type {
  HealthGetOutput,
  LocationGetInput,
  LocationGetOutput,
  AgentsListInput,
  AgentsListOutput,
  SessionsListInput,
  SessionsListOutput,
  SessionsCreateInput,
  SessionsCreateOutput,
  SessionsActiveOutput,
  SessionsGetInput,
  SessionsGetOutput,
  SessionsSwitchAgentInput,
  SessionsSwitchAgentOutput,
  SessionsSwitchModelInput,
  SessionsSwitchModelOutput,
  SessionsPromptInput,
  SessionsPromptOutput,
  SessionsCompactInput,
  SessionsCompactOutput,
  SessionsWaitInput,
  SessionsWaitOutput,
  SessionsStageInput,
  SessionsStageOutput,
  SessionsClearInput,
  SessionsClearOutput,
  SessionsCommitInput,
  SessionsCommitOutput,
  SessionsContextInput,
  SessionsContextOutput,
  SessionsHistoryInput,
  SessionsHistoryOutput,
  SessionsEventsInput,
  SessionsEventsOutput,
  SessionsInterruptInput,
  SessionsInterruptOutput,
  SessionsMessageInput,
  SessionsMessageOutput,
  MessagesListInput,
  MessagesListOutput,
  ModelsListInput,
  ModelsListOutput,
  ProvidersListInput,
  ProvidersListOutput,
  ProvidersGetInput,
  ProvidersGetOutput,
  IntegrationsListInput,
  IntegrationsListOutput,
  IntegrationsGetInput,
  IntegrationsGetOutput,
  IntegrationsConnectKeyInput,
  IntegrationsConnectKeyOutput,
  IntegrationsConnectOauthInput,
  IntegrationsConnectOauthOutput,
  IntegrationsAttemptStatusInput,
  IntegrationsAttemptStatusOutput,
  IntegrationsAttemptCompleteInput,
  IntegrationsAttemptCompleteOutput,
  IntegrationsAttemptCancelInput,
  IntegrationsAttemptCancelOutput,
  CredentialsUpdateInput,
  CredentialsUpdateOutput,
  CredentialsRemoveInput,
  CredentialsRemoveOutput,
  PermissionsListRequestsInput,
  PermissionsListRequestsOutput,
  PermissionsListSavedInput,
  PermissionsListSavedOutput,
  PermissionsRemoveSavedInput,
  PermissionsRemoveSavedOutput,
  PermissionsCreateInput,
  PermissionsCreateOutput,
  PermissionsListInput,
  PermissionsListOutput,
  PermissionsGetInput,
  PermissionsGetOutput,
  PermissionsReplyInput,
  PermissionsReplyOutput,
  FilesListInput,
  FilesListOutput,
  FilesFindInput,
  FilesFindOutput,
  CommandsListInput,
  CommandsListOutput,
  SkillsListInput,
  SkillsListOutput,
  EventsSubscribeOutput,
  PtysListInput,
  PtysListOutput,
  PtysCreateInput,
  PtysCreateOutput,
  PtysGetInput,
  PtysGetOutput,
  PtysUpdateInput,
  PtysUpdateOutput,
  PtysRemoveInput,
  PtysRemoveOutput,
  QuestionsListRequestsInput,
  QuestionsListRequestsOutput,
  QuestionsListInput,
  QuestionsListOutput,
  QuestionsReplyInput,
  QuestionsReplyOutput,
  QuestionsRejectInput,
  QuestionsRejectOutput,
  ReferencesListInput,
  ReferencesListOutput,
  ProjectCopiesCreateInput,
  ProjectCopiesCreateOutput,
  ProjectCopiesRemoveInput,
  ProjectCopiesRemoveOutput,
  ProjectCopiesRefreshInput,
  ProjectCopiesRefreshOutput,
  ServerCoordinationStatusOutput,
  ServerCoordinationDataAnalysisAwarenessReceiptInput,
  ServerCoordinationDataAnalysisAwarenessReceiptOutput,
  ServerCoordinationDataAnalysisResultRegisterInput,
  ServerCoordinationDataAnalysisResultRegisterOutput,
  ServerCoordinationDataAnalysisAwarenessDeliverInput,
  ServerCoordinationDataAnalysisAwarenessDeliverOutput,
  ServerCoordinationDataCooperationGetInput,
  ServerCoordinationDataCooperationGetOutput,
  ServerCoordinationDataCooperationPutInput,
  ServerCoordinationDataCooperationPutOutput,
  ServerCoordinationDataAnalysisExportInput,
  ServerCoordinationDataAnalysisExportOutput,
  ServerCoordinationDataMeOutput,
  ServerCoordinationDataProvisioningListOutput,
  ServerCoordinationDataSessionProvisionInput,
  ServerCoordinationDataSessionProvisionOutput,
  ServerCoordinationDataProjectListOutput,
  ServerCoordinationDataProjectCreateInput,
  ServerCoordinationDataProjectCreateOutput,
  ServerCoordinationDataProjectGetInput,
  ServerCoordinationDataProjectGetOutput,
  ServerCoordinationDataProjectBriefGetInput,
  ServerCoordinationDataProjectBriefGetOutput,
  ServerCoordinationDataProjectBriefPutInput,
  ServerCoordinationDataProjectBriefPutOutput,
  ServerCoordinationDataPersonFocusListInput,
  ServerCoordinationDataPersonFocusListOutput,
  ServerCoordinationDataPersonFocusPutInput,
  ServerCoordinationDataPersonFocusPutOutput,
  ServerCoordinationDataMemberGrantInput,
  ServerCoordinationDataMemberGrantOutput,
  ServerCoordinationDataContributionListInput,
  ServerCoordinationDataContributionListOutput,
  ServerCoordinationDataProjectThreadListInput,
  ServerCoordinationDataProjectThreadListOutput,
  ServerCoordinationDataThreadCreateInput,
  ServerCoordinationDataThreadCreateOutput,
  ServerCoordinationDataThreadGetInput,
  ServerCoordinationDataThreadGetOutput,
  ServerCoordinationDataCommentListInput,
  ServerCoordinationDataCommentListOutput,
  ServerCoordinationDataCommentCreateInput,
  ServerCoordinationDataCommentCreateOutput,
  ServerCoordinationDataInstructionSubmitInput,
  ServerCoordinationDataInstructionSubmitOutput,
  ServerCoordinationDataInstructionCancelInput,
  ServerCoordinationDataInstructionCancelOutput,
  ServerCoordinationDataRunnerReserveInput,
  ServerCoordinationDataRunnerReserveOutput,
  ServerCoordinationDataRunnerReportInput,
  ServerCoordinationDataRunnerReportOutput,
  ServerCoordinationDataApprovalClaimInput,
  ServerCoordinationDataApprovalClaimOutput,
  ServerCoordinationDataApprovalDecideInput,
  ServerCoordinationDataApprovalDecideOutput,
  ServerCoordinationDataProjectReplayInput,
  ServerCoordinationDataProjectReplayOutput,
  ServerCoordinationDataProjectStreamInput,
  ServerCoordinationDataProjectStreamOutput,
  ServerCoordinationDataThreadReplayInput,
  ServerCoordinationDataThreadReplayOutput,
  ServerCoordinationDataThreadStreamInput,
  ServerCoordinationDataThreadStreamOutput,
  ServerCoordinationDataWorkCardGetInput,
  ServerCoordinationDataWorkCardGetOutput,
  ServerCoordinationDataWorkCardUpdateInput,
  ServerCoordinationDataWorkCardUpdateOutput,
  ServerCoordinationDataWorkCardListInput,
  ServerCoordinationDataWorkCardListOutput,
  ServerCoordinationDataActivityListInput,
  ServerCoordinationDataActivityListOutput,
} from "./types"
import { ClientError } from "./client-error"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: HeadersInit
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
}

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const url = new URL(descriptor.path, options.baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status)) throw await json(response)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType")
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > 1_048_576) throw new ClientError("MalformedResponse")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/api/health`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    location: {
      get: (input?: LocationGetInput, requestOptions?: RequestOptions) =>
        request<LocationGetOutput>(
          {
            method: "GET",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    agents: {
      list: (input?: AgentsListInput, requestOptions?: RequestOptions) =>
        request<AgentsListOutput>(
          {
            method: "GET",
            path: `/api/agent`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    sessions: {
      list: (input?: SessionsListInput, requestOptions?: RequestOptions) =>
        request<SessionsListOutput>(
          {
            method: "GET",
            path: `/api/session`,
            query: {
              workspace: input?.["workspace"],
              limit: input?.["limit"],
              order: input?.["order"],
              search: input?.["search"],
              directory: input?.["directory"],
              project: input?.["project"],
              subpath: input?.["subpath"],
              cursor: input?.["cursor"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: SessionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session`,
            body: {
              id: input?.["id"],
              agent: input?.["agent"],
              model: input?.["model"],
              location: input?.["location"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      active: (requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsActiveOutput }>(
          {
            method: "GET",
            path: `/api/session/active`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: SessionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      switchAgent: (input: SessionsSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchAgentOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
            body: { agent: input["agent"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionsSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchModelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
            body: { model: input["model"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      prompt: (input: SessionsPromptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsPromptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: { id: input["id"], prompt: input["prompt"], delivery: input["delivery"], resume: input["resume"] },
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      compact: (input: SessionsCompactInput, requestOptions?: RequestOptions) =>
        request<SessionsCompactOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      wait: (input: SessionsWaitInput, requestOptions?: RequestOptions) =>
        request<SessionsWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/wait`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      stage: (input: SessionsStageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsStageOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
            body: { messageID: input["messageID"], files: input["files"] },
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      clear: (input: SessionsClearInput, requestOptions?: RequestOptions) =>
        request<SessionsClearOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/clear`,
            successStatus: 204,
            declaredStatuses: [404, 500, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      commit: (input: SessionsCommitInput, requestOptions?: RequestOptions) =>
        request<SessionsCommitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      context: (input: SessionsContextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsContextOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      history: (input: SessionsHistoryInput, requestOptions?: RequestOptions) =>
        request<SessionsHistoryOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/history`,
            query: { limit: input["limit"], after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      events: (input: SessionsEventsInput, requestOptions?: RequestOptions): AsyncIterable<SessionsEventsOutput> =>
        sse<SessionsEventsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/event`,
            query: { after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionsInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionsInterruptOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      message: (input: SessionsMessageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsMessageOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    messages: {
      list: (input: MessagesListInput, requestOptions?: RequestOptions) =>
        request<MessagesListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], order: input["order"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 404, 500, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    models: {
      list: (input?: ModelsListInput, requestOptions?: RequestOptions) =>
        request<ModelsListOutput>(
          {
            method: "GET",
            path: `/api/model`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    providers: {
      list: (input?: ProvidersListInput, requestOptions?: RequestOptions) =>
        request<ProvidersListOutput>(
          {
            method: "GET",
            path: `/api/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProvidersGetInput, requestOptions?: RequestOptions) =>
        request<ProvidersGetOutput>(
          {
            method: "GET",
            path: `/api/provider/${encodeURIComponent(input.providerID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    integrations: {
      list: (input?: IntegrationsListInput, requestOptions?: RequestOptions) =>
        request<IntegrationsListOutput>(
          {
            method: "GET",
            path: `/api/integration`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationsGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationsGetOutput>(
          {
            method: "GET",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connectKey: (input: IntegrationsConnectKeyInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectKeyOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
            query: { location: input["location"] },
            body: { key: input["key"], label: input["label"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      connectOauth: (input: IntegrationsConnectOauthInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectOauthOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
            query: { location: input["location"] },
            body: { methodID: input["methodID"], inputs: input["inputs"], label: input["label"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      attemptStatus: (input: IntegrationsAttemptStatusInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptStatusOutput>(
          {
            method: "GET",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      attemptComplete: (input: IntegrationsAttemptCompleteInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCompleteOutput>(
          {
            method: "POST",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}/complete`,
            query: { location: input["location"] },
            body: { code: input["code"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      attemptCancel: (input: IntegrationsAttemptCancelInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCancelOutput>(
          {
            method: "DELETE",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    credentials: {
      update: (input: CredentialsUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialsUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            body: { label: input["label"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialsRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    permissions: {
      listRequests: (input?: PermissionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<PermissionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/permission/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      listSaved: (input?: PermissionsListSavedInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListSavedOutput }>(
          {
            method: "GET",
            path: `/api/permission/saved`,
            query: { projectID: input?.["projectID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      removeSaved: (input: PermissionsRemoveSavedInput, requestOptions?: RequestOptions) =>
        request<PermissionsRemoveSavedOutput>(
          {
            method: "DELETE",
            path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      create: (input: PermissionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            body: {
              id: input["id"],
              action: input["action"],
              resources: input["resources"],
              save: input["save"],
              metadata: input["metadata"],
              source: input["source"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      list: (input: PermissionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: PermissionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: PermissionsReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { reply: input["reply"], message: input["message"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    files: {
      list: (input?: FilesListInput, requestOptions?: RequestOptions) =>
        request<FilesListOutput>(
          {
            method: "GET",
            path: `/api/fs/list`,
            query: { location: input?.["location"], path: input?.["path"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      find: (input: FilesFindInput, requestOptions?: RequestOptions) =>
        request<FilesFindOutput>(
          {
            method: "GET",
            path: `/api/fs/find`,
            query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    commands: {
      list: (input?: CommandsListInput, requestOptions?: RequestOptions) =>
        request<CommandsListOutput>(
          {
            method: "GET",
            path: `/api/command`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    skills: {
      list: (input?: SkillsListInput, requestOptions?: RequestOptions) =>
        request<SkillsListOutput>(
          {
            method: "GET",
            path: `/api/skill`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    events: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventsSubscribeOutput> =>
        sse<EventsSubscribeOutput>(
          { method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    ptys: {
      list: (input?: PtysListInput, requestOptions?: RequestOptions) =>
        request<PtysListOutput>(
          {
            method: "GET",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: PtysCreateInput, requestOptions?: RequestOptions) =>
        request<PtysCreateOutput>(
          {
            method: "POST",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtysGetInput, requestOptions?: RequestOptions) =>
        request<PtysGetOutput>(
          {
            method: "GET",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtysUpdateInput, requestOptions?: RequestOptions) =>
        request<PtysUpdateOutput>(
          {
            method: "PUT",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtysRemoveInput, requestOptions?: RequestOptions) =>
        request<PtysRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    questions: {
      listRequests: (input?: QuestionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<QuestionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/question/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: QuestionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: QuestionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: QuestionsReplyInput, requestOptions?: RequestOptions) =>
        request<QuestionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reply`,
            body: { answers: input["answers"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      reject: (input: QuestionsRejectInput, requestOptions?: RequestOptions) =>
        request<QuestionsRejectOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reject`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    references: {
      list: (input?: ReferencesListInput, requestOptions?: RequestOptions) =>
        request<ReferencesListOutput>(
          {
            method: "GET",
            path: `/api/reference`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    projectCopies: {
      create: (input: ProjectCopiesCreateInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesCreateOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { strategy: input["strategy"], directory: input["directory"], name: input["name"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ProjectCopiesRemoveInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { directory: input["directory"], force: input["force"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      refresh: (input: ProjectCopiesRefreshInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRefreshOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/refresh`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    "server.coordination": {
      status: (requestOptions?: RequestOptions) =>
        request<ServerCoordinationStatusOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/status`,
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    "server.coordination.data": {
      analysisAwarenessReceipt: (
        input: ServerCoordinationDataAnalysisAwarenessReceiptInput,
        requestOptions?: RequestOptions,
      ) =>
        request<ServerCoordinationDataAnalysisAwarenessReceiptOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/analysis/awareness/${encodeURIComponent(input.reportId)}/${encodeURIComponent(input.noteId)}`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      analysisResultRegister: (
        input: ServerCoordinationDataAnalysisResultRegisterInput,
        requestOptions?: RequestOptions,
      ) =>
        request<ServerCoordinationDataAnalysisResultRegisterOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/analysis/results`,
            body: {
              requestId: input["requestId"],
              reportId: input["reportId"],
              sourceThreadId: input["sourceThreadId"],
              targetThreadId: input["targetThreadId"],
              sourceActivitySeq: input["sourceActivitySeq"],
              targetActivitySeq: input["targetActivitySeq"],
              cooperationVersions: input["cooperationVersions"],
              awarenessNoteCandidates: input["awarenessNoteCandidates"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      analysisAwarenessDeliver: (
        input: ServerCoordinationDataAnalysisAwarenessDeliverInput,
        requestOptions?: RequestOptions,
      ) =>
        request<ServerCoordinationDataAnalysisAwarenessDeliverOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/analysis/awareness`,
            body: { reportId: input["reportId"], noteId: input["noteId"], messageId: input["messageId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      cooperationGet: (input: ServerCoordinationDataCooperationGetInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataCooperationGetOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/cooperation`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      cooperationPut: (input: ServerCoordinationDataCooperationPutInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataCooperationPutOutput>(
          {
            method: "PUT",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/cooperation`,
            body: {
              requestId: input["requestId"],
              expectedVersion: input["expectedVersion"],
              featureTopic: input["featureTopic"],
              relationship: input["relationship"],
              analysisEnabled: input["analysisEnabled"],
              analysisTextEnabled: input["analysisTextEnabled"],
              awarenessMode: input["awarenessMode"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      analysisExport: (input: ServerCoordinationDataAnalysisExportInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataAnalysisExportOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/analysis/export`,
            body: {
              requestId: input["requestId"],
              sourceThreadId: input["sourceThreadId"],
              targetThreadId: input["targetThreadId"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      me: (requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataMeOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/me`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      provisioningList: (requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProvisioningListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/provisioning`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      sessionProvision: (input: ServerCoordinationDataSessionProvisionInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataSessionProvisionOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/sessions`,
            body: { requestId: input["requestId"], title: input["title"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectList: (requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProjectListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectCreate: (input: ServerCoordinationDataProjectCreateInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProjectCreateOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/projects`,
            body: { projectId: input["projectId"], name: input["name"], requestId: input["requestId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectGet: (input: ServerCoordinationDataProjectGetInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProjectGetOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectBriefGet: (input: ServerCoordinationDataProjectBriefGetInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProjectBriefGetOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/brief`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectBriefPut: (input: ServerCoordinationDataProjectBriefPutInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProjectBriefPutOutput>(
          {
            method: "PUT",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/brief`,
            body: {
              requestId: input["requestId"],
              expectedVersion: input["expectedVersion"],
              content: input["content"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      personFocusList: (input: ServerCoordinationDataPersonFocusListInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataPersonFocusListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/focus`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      personFocusPut: (input: ServerCoordinationDataPersonFocusPutInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataPersonFocusPutOutput>(
          {
            method: "PUT",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/focus/me`,
            body: { requestId: input["requestId"], expectedVersion: input["expectedVersion"], text: input["text"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      memberGrant: (input: ServerCoordinationDataMemberGrantInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataMemberGrantOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/members`,
            body: { targetUserId: input["targetUserId"], requestId: input["requestId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      contributionList: (input: ServerCoordinationDataContributionListInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataContributionListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/contributions`,
            query: { userId: input["userId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectThreadList: (input: ServerCoordinationDataProjectThreadListInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProjectThreadListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/threads`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      threadCreate: (input: ServerCoordinationDataThreadCreateInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataThreadCreateOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/threads`,
            body: { sessionId: input["sessionId"], title: input["title"], requestId: input["requestId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      threadGet: (input: ServerCoordinationDataThreadGetInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataThreadGetOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      commentList: (input: ServerCoordinationDataCommentListInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataCommentListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/comments`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      commentCreate: (input: ServerCoordinationDataCommentCreateInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataCommentCreateOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/comments`,
            body: { requestId: input["requestId"], body: input["body"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      instructionSubmit: (input: ServerCoordinationDataInstructionSubmitInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataInstructionSubmitOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/instructions`,
            body: { requestId: input["requestId"], text: input["text"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      instructionCancel: (input: ServerCoordinationDataInstructionCancelInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataInstructionCancelOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/instructions/${encodeURIComponent(input.instructionId)}/cancel`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      runnerReserve: (input: ServerCoordinationDataRunnerReserveInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataRunnerReserveOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/runner/threads/${encodeURIComponent(input.threadId)}/reserve`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      runnerReport: (input: ServerCoordinationDataRunnerReportInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataRunnerReportOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/runner/runs/${encodeURIComponent(input.runId)}/events`,
            body: { callbackId: input["callbackId"], callback: input["callback"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      approvalClaim: (input: ServerCoordinationDataApprovalClaimInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataApprovalClaimOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/approvals/${encodeURIComponent(input.approvalId)}/claim`,
            body: { expectedVersion: input["expectedVersion"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      approvalDecide: (input: ServerCoordinationDataApprovalDecideInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataApprovalDecideOutput>(
          {
            method: "POST",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/approvals/${encodeURIComponent(input.approvalId)}/decision`,
            body: {
              expectedVersion: input["expectedVersion"],
              decisionId: input["decisionId"],
              decision: input["decision"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectReplay: (input: ServerCoordinationDataProjectReplayInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataProjectReplayOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/events`,
            query: { after: input["after"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      projectStream: (
        input: ServerCoordinationDataProjectStreamInput,
        requestOptions?: RequestOptions,
      ): AsyncIterable<ServerCoordinationDataProjectStreamOutput> =>
        sse<ServerCoordinationDataProjectStreamOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/events/stream`,
            query: { after: input["after"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      threadReplay: (input: ServerCoordinationDataThreadReplayInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataThreadReplayOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/events`,
            query: { after: input["after"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      threadStream: (
        input: ServerCoordinationDataThreadStreamInput,
        requestOptions?: RequestOptions,
      ): AsyncIterable<ServerCoordinationDataThreadStreamOutput> =>
        sse<ServerCoordinationDataThreadStreamOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/events/stream`,
            query: { after: input["after"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      workCardGet: (input: ServerCoordinationDataWorkCardGetInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataWorkCardGetOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/work-card`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      workCardUpdate: (input: ServerCoordinationDataWorkCardUpdateInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataWorkCardUpdateOutput>(
          {
            method: "PUT",
            path: `/api/coordination/v1/threads/${encodeURIComponent(input.threadId)}/work-card`,
            body: {
              expectedVersion: input["expectedVersion"],
              sourceActivitySeq: input["sourceActivitySeq"],
              card: input["card"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      workCardList: (input: ServerCoordinationDataWorkCardListInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataWorkCardListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/work-cards`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      activityList: (input: ServerCoordinationDataActivityListInput, requestOptions?: RequestOptions) =>
        request<ServerCoordinationDataActivityListOutput>(
          {
            method: "GET",
            path: `/api/coordination/v1/projects/${encodeURIComponent(input.projectId)}/activity`,
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
