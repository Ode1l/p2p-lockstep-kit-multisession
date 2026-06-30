# p2p-lockstep-kit-multisession 项目 Prompt

下面整段内容可以直接作为新 Codex 线程的首条任务说明。不要依赖旧线程的 Codex context；必须从仓库文档和源码重新建立事实。

---

你是一名负责 TypeScript、WebRTC、分布式协议和回合制游戏状态机的高级工程师。请在当前仓库实现一个可发布的多人会话库：

```text
p2p-lockstep-kit-multisession
```

这个项目不是具体游戏、不是 Web 页面应用、不是大厅服务器，也不是把旧 1v1 Session 简单改成数组。它是支持 2～10 人 P2P 回合制游戏的通用多人 Session 层，未来主要服务麻将等带座位、多人操作窗口、公开状态和私有状态的游戏。

## 一、开始工作前必须读取的上下文

先完整阅读并总结以下目录中的 README、Markdown、package.json、公开类型和关键实现。若目录结构已经变化，使用 `rg --files` 定位对应文件，不要凭旧路径猜测：

```text
../p2p-lockstep-kit/src/network
../p2p-lockstep-kit/src/session
../p2p-lockstep-kit/src/ui
../p2p-lockstep-kit/playground/gomoku
```

重点检查：

```text
network/index.ts
network/transport/rtcPeer.ts
network/signaling/*
session/state/*
session/handlers/*
session/observer/*
session/net.ts
session/utils/protocol/*
ui/README.md
ui/src/types.ts
ui/src/app-shell.ts
```

把源码和当前安装包声明当作事实来源。旧文档与源码不一致时，以当前公开 API、测试和实际行为为准。旧的独立 network/session/ui 仓库如果仍存在，也要阅读其 Markdown，但不要擅自修改旧项目。

不要更新 Codex context 文件。需要长期保留的结论写入本项目正常的 `docs/*.md`、README、测试和类型定义。

## 二、已经确定的产品和架构决策，不要再次询问

### 1. 网络和部署边界

- 最大参与人数为 10 人。
- 使用 WebRTC DataChannel Full Mesh：每个参与者与其他所有参与者保持直接连接。
- 8 人时每台设备最多 7 个远端连接；10 人时最多 9 个，总连接数最多 45。
- 这是低频回合制数据通信，不包含多人音视频 Mesh。
- 保留现有信令服务用于注册、恢复、交换 SDP/ICE。
- TURN 可以作为 NAT 穿透失败时的可选数据中继，但不承担鉴权、房间状态、游戏逻辑或权威裁决。
- 不建设权威游戏服务器，不建设服务端鉴权，不建设公共大厅、公开房间列表或服务端匹配。
- 多人牌桌通过私有邀请链接或邀请信息进入。

### 2. 排序与状态权威

- Full Mesh 是物理传输拓扑。
- 房主是逻辑 `Coordinator`，负责接收命令、分配连续全局 `seq`、产生有序事件并广播。
- Coordinator 不是权威游戏服务器；所有节点必须独立验证事件并执行相同的确定性 reducer。
- 任何无效事件、序号跳跃、哈希断裂或同一序号的不同事件都不能静默写入状态。
- Full Mesh 连接用于直接私信、事件广播、同步、交叉核对和发现 Coordinator 向不同节点发送不同历史的行为。

### 3. 项目边界

- `p2p-lockstep-kit-multisession` 是可发布的 npm 库，不是 Vite 页面应用。
- 必须生成真正的 JavaScript 构建产物和 `.d.ts`，不能出现 `pnpm build` 后只有源 `main.ts` 的情况。
- 未来多人通用 UI 应独立为 `p2p-lockstep-kit-multi-ui`；不要把多人逻辑硬塞进稳定的 1v1 UI。
- 本项目可以提供无样式的状态类型、observer 和 runtime facade，但不实现麻将牌桌 UI。
- 麻将规则、牌面、吃碰杠胡、计分和具体牌墙协议不属于通用 Session 核心。

## 三、可以从旧 1v1 项目复用的部分

这里的“复用”首先指复用思想、测试方式和经过验证的实现片段；只有在类型语义仍然正确时才直接复制代码。

### 可以复用

- 信令注册、`peerId` 恢复、ICE server 配置和 resume token 缓存的基本流程。
- 单个 `RtcPeer` 封装内部已经正确实现的 offer/answer/ICE/DataChannel 生命周期。
- JSON 序列化、`decodeSafe`、消息解析和错误隔离方式。
- Command Bus 的 type-to-handler 分发思想。
- observer/subscription 模式和取消订阅机制。
- 结构化日志、错误通知和无效远端输入不污染状态的原则。
- 有序历史作为同步和重放依据的思想。
- `SYNC_REQUEST` / `SYNC_STATE` 的恢复目标：重连后恢复确定性历史，而不是只恢复网络身份。
- Ready、Start、Undo、Restart、Offline、Online、Sync 等产品能力的概念。
- 游戏插件负责规则验证、Session 负责协议和顺序的职责边界。
- Vitest、TypeScript strict、pnpm lockfile、构建和发布校验方式。
- 1v1 UI 中已经验证过的重要信息展示原则：身份、连接、Ready、当前阶段、回合、历史、待处理请求、同步状态和错误不能被省略。

### 绝对不能直接照搬

- `PlayerLabel = "local" | "remote"`。
- 一个 `local` FSM 加一个 `remote` FSM 的镜像模型。
- `private peer: RtcPeer | null`、`getRemotePeerId()` 和只能发送给一个远端的 `send()`。
- 收包后统一标记 `from: "remote"`。
- 同步时进行 `local/remote` 视角翻转。
- 两人轮流先手、二元 turn/remote_turn、二方 undo/restart 审批。
- `checkWin(): "local" | "remote" | null` 的单赢家模型。
- 全局单例 Session Context。
- Session 直接依赖具体 `NetworkClient` 的紧耦合。
- 把 share URL、`requesting` 或正在握手误判成已经加入牌桌。
- 把 network resume 当成 game/session sync。

## 四、以下新设计采用给定方案，不需要用户逐项判断

### 1. 身份必须分层

至少定义并严格区分：

```ts
type TableId = string;
type GameId = string;
type ParticipantId = string;
type PeerId = string;
type SeatId = string;
type EventId = string;
```

- `ParticipantId`：牌桌会话中的稳定成员身份，重连后保持不变。
- `PeerId`：当前信令/WebRTC 连接身份，可以恢复或更换。
- `SeatId`：游戏座位或角色，例如麻将东南西北；它不等于 Participant。
- `TableId`：私有牌桌生命周期。
- `GameId`：同一牌桌内的一局游戏；Restart 或开新局不能混淆旧事件。

状态中使用：

```ts
participants: Map<ParticipantId, Participant>
connections: Map<ParticipantId, PeerConnectionState>
seats: Map<SeatId, ParticipantId | null>
```

不要再通过“本地视角/远端视角”重写事件身份。事件中始终使用稳定的 `ParticipantId`。

### 2. 多 Peer 传输接口

MultiSession 只依赖抽象接口，不直接创建具体旧 `NetworkClient`：

```ts
interface MultiPeerTransport {
  readonly localPeerId: PeerId | null;
  connect(peerId: PeerId): Promise<void>;
  disconnect(peerId: PeerId): void;
  sendTo(peerId: PeerId, message: unknown): void;
  broadcast(message: unknown, except?: ReadonlySet<PeerId>): void;
  getPeerState(peerId: PeerId): PeerConnectionState;
  getConnectedPeerIds(): readonly PeerId[];
  onMessage(handler: (peerId: PeerId, message: unknown) => void): Unsubscribe;
  onPeerStateChange(handler: (peerId: PeerId, state: PeerConnectionState) => void): Unsubscribe;
}
```

允许根据实际代码调整命名，但能力和依赖方向不能退化。

Full Mesh 建连必须：

- 使用稳定规则决定每一对 Peer 的唯一 offer 发起方，例如比较规范化后的 PeerId，避免 glare。
- 每台设备限制并发 ICE 协商数量，例如 2～3 个，分批建连。
- 一个 PeerConnection 上优先使用一个可靠有序 DataChannel，在应用消息层复用协议类型。
- 单个 Peer 重连时只修复对应连接，不销毁整个 Mesh。
- 暴露逐 Peer 状态，不能只暴露全局 `connected: boolean`。
- 明确定义 `meshReady`：所需成员全部直连完成；它不等于“至少连上一个人”。

如果需要修改旧 network 包，必须新增向后兼容的多 Peer API，保留现有 1v1 `NetworkClient` 行为；不要在没有用户授权时破坏旧包。若当前任务只允许修改 multisession 仓库，先实现接口、fake transport 和完整 Session 测试，再在文档中列出 network adapter 的独立工作项。

### 3. 加入 Full Mesh 的流程

采用下面的基本流程：

```text
邀请链接指向 Coordinator
  -> 新节点只先连接 Coordinator
  -> 提交 JOIN_REQUEST
  -> Coordinator 接受并发布 MEMBERSHIP_JOINED
  -> 新节点获得当前 Participant/Peer roster
  -> 新旧节点按确定规则互相建立连接
  -> 所需 Peer 全部连接并确认
  -> Participant 进入 connected/ready 状态
```

不能因为 URL 中存在 table/coordinator 信息就直接显示已进入游戏。必须区分：

```text
invited -> joining -> mesh_connecting -> seated -> ready -> playing
```

### 4. 有序事件日志

所有公共状态变化使用不可变有序事件：

```ts
interface OrderedEvent<T = unknown> {
  eventId: EventId;
  tableId: TableId;
  gameId: GameId;
  seq: number;
  coordinatorEpoch: number;
  actorId: ParticipantId;
  type: string;
  payload: T;
  previousHash: string | null;
  eventHash: string;
}
```

协议必须具备：

- discriminated union。
- `protocol` 和 `version`。
- `messageId` 去重。
- `tableId`、`gameId` 隔离。
- 明确的 sender Participant/Peer。
- runtime schema validation；不能用 TypeScript 类型断言代替输入验证。
- 重复事件幂等处理。
- 缺失 `seq` 时暂停应用后续事件并触发同步。
- `previousHash` / `eventHash` 链接公共日志。
- `coordinatorEpoch` 为未来 Coordinator 迁移保留协议空间。

客户端提交的是 `CommandRequest`，Coordinator 验证基本资格并转换成 `OrderedEvent`。其他 Peer 收到后仍必须用相同插件独立验证。无效事件进入明确的 protocol error 状态，不能“尽量执行”。

为了检测 Coordinator equivocation，Peer 在 Full Mesh 上交换轻量 checkpoint：

```text
EVENT_ACK(seq, eventHash)
```

同一 `coordinatorEpoch + seq` 出现不同 hash 时必须停止推进并报告冲突。

### 5. State、Reducer 和 Plugin

核心状态至少包含：

```ts
interface MultiSessionState {
  tableId: TableId;
  gameId: GameId | null;
  phase: SessionPhase;
  localParticipantId: ParticipantId;
  coordinatorId: ParticipantId;
  coordinatorEpoch: number;
  participants: ReadonlyMap<ParticipantId, Participant>;
  seats: ReadonlyMap<SeatId, ParticipantId | null>;
  ready: ReadonlyMap<ParticipantId, boolean>;
  connections: ReadonlyMap<ParticipantId, PeerConnectionState>;
  lastAppliedSeq: number;
  lastEventHash: string | null;
  pendingDecisionWindow: DecisionWindow | null;
  sync: SyncState;
  outcome: GameOutcome | null;
}
```

不要为每名玩家复制一套完整 Session FSM。使用一个牌桌/牌局状态机，加 Participant 状态 Map。状态转换必须实例作用域化，允许测试中同时创建多个 Session，不使用全局 Context。

游戏扩展接口必须支持泛型命令、事件、状态和多种结局，至少覆盖：

```ts
type GameOutcome =
  | { type: "winner"; winners: ParticipantId[] }
  | { type: "draw"; reason?: string }
  | { type: "ranking"; order: ParticipantId[] }
  | { type: "aborted"; reason: string };
```

插件职责需要覆盖：

- 创建确定性初始状态。
- 验证某 Participant 在当前状态能否提交命令。
- 将已排序事件纯函数式地 reduce 成下一状态。
- 返回当前可行动者或多人 `DecisionWindow`。
- 根据游戏规则解决多人同时响应的优先级。
- 计算 winner/draw/multiple winners/ranking/aborted。
- 生成可序列化快照或从事件重放。

不要把麻将专有的“碰优先于吃、胡优先于碰”等规则写入 MultiSession；由麻将插件提供决策窗口和 resolution policy。

### 6. 多人决策窗口

多人游戏不能只用简单 turn owner。核心需要抽象：

```ts
interface DecisionWindow {
  id: string;
  openedAtSeq: number;
  eligibleParticipantIds: readonly ParticipantId[];
  submittedParticipantIds: readonly ParticipantId[];
  mode: "single" | "simultaneous";
  deadline?: number;
}
```

顺序回合是只有一个 eligible Participant 的窗口；麻将出牌后的吃碰杠胡属于多人 simultaneous window。Coordinator 收集 intent，插件按确定性规则解析并产生唯一的有序结果事件。

### 7. 同步与重连

明确区分：

```text
恢复 PeerId/信令身份
恢复 Participant 牌桌成员身份
恢复 Full Mesh 连接
恢复公共事件历史
恢复本地私有状态
```

同步协议至少支持：

- `SYNC_REQUEST` 携带本地 `lastAppliedSeq` 和 `lastEventHash`。
- 缺少少量事件时发送 tail events。
- 差距较大时发送 checkpoint snapshot + tail。
- snapshot 必须包含生成它的 seq/hash，并能通过后续事件验证。
- 优先从 Coordinator 获取，再与至少一个其他 Peer 的 checkpoint 核对。
- 同步过程中禁止本地提交游戏命令。
- 页面从后台恢复时自动检测所有 Peer 连接和 seq，不要求用户手动刷新才启动重连。
- Fresh invite 或陈旧 URL 不能把用户直接带到 Ready/Start 游戏画面；只有成员恢复成功或实际加入成功才进入牌桌。

公共事件日志不能恢复玩家的秘密手牌。私有状态恢复必须有独立设计：本地持久化、重新获取加密份额，或未来 Mental Poker 协议；不能把所有私有状态塞进公共 `SYNC_STATE`。

### 8. Observer 和未来 Multi UI 所需信息

公开 snapshot 必须让未来 `p2p-lockstep-kit-multi-ui` 能完整展示：

- TableId/GameId。
- 本地 Participant、Coordinator 和座位。
- 全部 Participant 的显示名、座位、Ready、在线/离线/重连状态。
- 每一条 Peer 连接状态以及 Mesh 是否完整。
- 当前 phase、当前行动者、DecisionWindow 和已经响应的人。
- 当前 seq、history 长度、checkpoint hash。
- pending proposal/approval。
- sync 进度、协议冲突和最近错误。

多人 UI 使用私有牌桌/座位模型，不使用公共大厅模型。手机端和 desktop 端都必须可用，但 UI 实现在独立项目完成。

## 五、必须保留为用户产品决策的问题

第一次完成源码审计和架构草案后，只向用户集中询问下面尚未确定、且会改变行为的问题。每个问题给出推荐默认值和影响，不要零散追问，不要擅自把偏好写死。

1. **人数与开局条件**
   - 每个游戏插件定义固定人数，还是 `minPlayers/maxPlayers`？
   - 推荐：核心支持 2～10；插件声明范围；只有所有已占用必需座位 Ready 才能开始。

2. **进行中成员变化**
   - 是否允许牌局进行中加入、换座或旁观？
   - 推荐 v1：游戏进行中禁止新增玩家和换座；不实现 spectator，但保留角色字段。

3. **Coordinator 掉线**
   - 立即终止、等待宽限期，还是 v1 就实现选举与迁移？
   - 推荐 v1：暂停并等待可配置宽限期；Coordinator 未恢复则本局 aborted。协议预留 `coordinatorEpoch`，迁移放后续版本。

4. **Undo、Restart、Kick 和解散规则**
   - 房主决定、简单多数、全体同意，还是由游戏插件决定？
   - 推荐：通用 Proposal/Vote 机制，具体 quorum policy 可配置；涉及回滚公开历史时默认全体同意。

5. **操作超时和掉线玩家**
   - 超时是自动 pass、托管、判负、移出本局还是无限等待？
   - 推荐：核心只提供 deadline 和 timeout event；后果由插件/应用配置。

6. **随机与反作弊信任模型**
   - v1 是否接受可信房主使用 `crypto.getRandomValues()` 洗牌并看到完整牌墙？
   - 还是从第一版就要求无可信方的 Mental Poker？
   - 推荐 v1：可信房主 CSPRNG，适合熟人游戏；Mental Poker 后续独立项目实现。
   - 不能把公开 commit-reveal 种子直接当隐藏牌墙，因为所有玩家会推导完整牌序。

7. **Participant 恢复范围**
   - 只要求同一浏览器/设备恢复，还是允许换设备接管原 Participant？
   - 推荐 v1：同一浏览器保存高熵 resume credential；换设备接管后续设计。

8. **跨仓库修改范围**
   - 是否允许同时给旧 network 包增加向后兼容的 `MultiNetworkClient` / Full Mesh adapter？
   - 推荐：先稳定 `MultiPeerTransport` 契约和 fake transport 测试，再单独改 network 包，保留 1v1 API。

这些问题之外的内部类名、文件拆分、测试组织、错误类型、不可变数据实现等工程细节由你选择合理方案，不要让用户替你做普通工程判断。

## 六、随机、私有信息与 Mental Poker 的边界

MultiSession 核心不得内置麻将牌或自行发明密码学。它只提供：

- 公共有序事件。
- 点对点私有消息能力。
- 可携带 commitment/proof 的协议扩展字段。
- 私有消息与公共事件的关联 ID。
- 插件级 `HiddenInformationProtocol` / `DeckProtocol` 扩展位置。

未来麻将项目可以定义：

```ts
interface TileDeckProtocol {
  createDeck(participants: readonly ParticipantId[]): Promise<DeckState>;
  drawFor(participantId: ParticipantId): Promise<PrivateDraw>;
  reveal(tileRef: TileRef): Promise<RevealedTile>;
  verify(event: DeckEvent): Promise<VerificationResult>;
}
```

候选实现：

```text
TrustedHostDeckProtocol   v1，房主 CSPRNG
MentalPokerDeckProtocol   后续，多方加密洗牌和可验证 shuffle
```

Mental Poker 若未来实现，必须采用经过同行评审的现有协议和审计过的密码学库，覆盖唯一牌编码、逐方重加密洗牌、零知识 shuffle proof、私人摸牌、公开揭牌、合谋模型和玩家中止。不要自行组合 RSA/ElGamal/哈希形成“看起来安全”的协议。

## 七、建议目录结构

根据实际工具链调整，但保持职责清晰：

```text
src/
  ids/
  protocol/
    envelope.ts
    messages.ts
    parser.ts
  transport/
    types.ts
    fake.ts
  membership/
  coordinator/
  event-log/
  sync/
  decision-window/
  state/
  plugin/
  observer/
  runtime/
  index.ts
docs/
  architecture.md
  protocol.md
  decisions.md
  network-adapter.md
tests/
```

避免循环依赖；公开入口只导出消费者真正需要的类型和 API。

## 八、分阶段执行顺序

### 阶段 1：审计和设计

- 阅读旧代码和文档。
- 输出“可复用 / 必须重写 / 缺失能力”矩阵。
- 写 `docs/architecture.md` 和初版协议状态图。
- 把第五节的产品问题一次性提交用户确认。
- 在用户回答影响语义的问题前，可以实现纯基础设施和测试框架，但不要固化未决产品政策。

### 阶段 2：纯 Session 核心

- ID、Participant、Seat、Membership 类型。
- Runtime schema validation。
- Ordered event log、hash chain、dedupe、gap detection。
- 牌桌状态机和纯 reducer。
- Game plugin、GameOutcome、DecisionWindow。
- Coordinator command ordering。
- Fake Full Mesh transport。
- 多实例测试，不使用浏览器即可运行。

### 阶段 3：同步和容错

- tail sync、snapshot + tail。
- checkpoint 交叉核对和 equivocation detection。
- Participant resume。
- 逐 Peer offline/online。
- 页面恢复所需 runtime API。

### 阶段 4：真实 Full Mesh adapter

- 在用户授权的仓库中实现 `Map<PeerId, RtcPeer>`。
- 确定性 offerer、并发建连限制、逐 Peer 重连。
- 真实浏览器集成测试：2、4、8、10 Peer。
- 模拟其中一名普通 Peer 掉线和恢复。
- 模拟 Coordinator 掉线。
- 测试部分连接经 TURN 的行为。

### 阶段 5：发布准备

- README API 示例。
- 包导出和 `.d.ts`。
- changelog/版本策略。
- 消费端 smoke test，从生成的 tarball 安装，不直接引用源码。
- 冻结 lockfile 安装、typecheck、test、build、pack 全部通过。

## 九、最低测试要求

至少覆盖：

- 2、4、8、10 Participant membership。
- ParticipantId、PeerId、SeatId 不混用。
- 同一个 Participant 更换 PeerId 后恢复。
- Full Mesh roster 中每对节点只建立一次逻辑连接。
- 消息重复、乱序、丢失、延迟到达。
- `seq` gap 触发同步，补齐后继续。
- snapshot + tail 重建结果与完整 replay 一致。
- Coordinator 发送同 seq 不同事件时所有诚实节点停止推进。
- 非成员、错误 table/game、错误版本、畸形 payload 被拒绝。
- 普通 Peer 离线不破坏其他 Peer 连接。
- 决策窗口收集多方 intent，并由插件确定性解决。
- 多赢家、平局、排名和 aborted outcome。
- public state 不包含其他 Participant 的 private payload。
- 旧 1v1 包 API 未被破坏。
- 每项测试结束后 listener、timer、Peer 和 observer 被清理。

真实浏览器测试除了桌面端，也必须覆盖至少一种 iOS Safari 或等价 WebKit 环境，以及 Android Chrome 或等价 Chromium 环境。记录 10 人时建连时间、重连时间、内存、消息往返和 TURN 使用情况；不要只根据理论连接数宣称可用。

## 十、构建和发布验收

`package.json` 至少满足：

- 正确的 `name`、`version`、`type`、`exports`、`types`、`files`。
- 发布库不能误设为应用；若准备 npm 发布则不要 `private: true`。
- `main/module/types` 指向实际生成文件。
- 不把测试、源码路径或 sibling repo 路径作为消费者运行时依赖。

最终必须实际执行并报告：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm pack
```

解包生成的 tarball，确认包含 JavaScript、`.d.ts`、README 和 package.json；再创建最小消费者项目安装该 tarball，验证类型导入和运行时导入均成功。

## 十一、工作方式

- 先报告事实和风险，再实现。
- 不要为了快速完成而把 `local/remote` 替换成数组。
- 不要把 Full Mesh 等同于所有节点重复广播完整状态。
- 不要引入 Kademlia、Gossip、稀疏图或服务端权威状态；当前最多 10 人，不需要这些复杂度。
- 不擅自修改旧 1v1 行为或发布版本。
- 不在通用库中写麻将规则。
- 不隐藏错误或自动选择冲突历史。
- 所有远端输入均视为不可信并做运行时校验。
- 每完成一个阶段，给出已完成内容、测试证据、剩余产品决策和下一步。

最终交付物应包含可发布库、架构文档、协议文档、测试和 Full Mesh adapter 边界说明，而不是只有一份概念设计。

---
