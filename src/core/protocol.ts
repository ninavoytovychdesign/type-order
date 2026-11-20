// Повідомлення між панеллю і кодом плагіна.
import { Spec } from './spec'
import { Stats, Combo, IssueKind } from './stats'
import { ExistingStyle } from './scale'
import { Lang } from './i18n'

export type Scope = 'selection' | 'page' | 'all'

export type SelectFilter =
  | { kind: 'family'; value: string }
  | { kind: 'size'; value: number }
  | { kind: 'style'; value: string }
  | { kind: 'combos'; value: string[] }
  | { kind: 'issue'; value: IssueKind }
  | { kind: 'nodes'; value: string[] }

export interface FontUse {
  family: string
  style: string
  layers: number
  /** Скільки з цих шарів привʼязано до бібліотечних стилів (їх плагін не змінює). */
  remoteLayers: number
  /** Шари, де цей шрифт не встановлено: Figma не дасть їх змінити. */
  missingLayers: number
}

export interface AnalysisVM {
  scope: Scope
  stats: Stats
  combos: Combo[]
  existing: ExistingStyle[]
  fonts: FontUse[]
  /** Локальні стилі за шрифтом: при заміні шрифту вони оновлюються, а не перебиваються. */
  localStylesByFamily: Record<string, number>
  mainLayers: number
}

export interface ProposalIn {
  name: string
  spec: Spec
  members: string[]
  existingId?: string
}

export interface ReportProposal {
  name: string
  spec: Spec
  layers: number
  existing: boolean
}

export type ToMain =
  | { type: 'init' }
  | { type: 'set-lang'; lang: Lang }
  | { type: 'analyze'; scope: Scope }
  | { type: 'cancel' }
  | { type: 'select'; filter: SelectFilter }
  | { type: 'list-families' }
  | { type: 'family-styles'; family: string }
  | { type: 'apply-fonts'; target: string; mapping: Record<string, string>; includeMain: boolean }
  | { type: 'apply-styles'; proposals: ProposalIn[]; link: boolean; includeMain: boolean }
  | { type: 'reset-overrides'; includeMain: boolean }
  | { type: 'report'; proposals: ReportProposal[] }
  | { type: 'resize'; height: number }

export interface Notice {
  code: string
  params?: Record<string, string | number>
  level: 'ok' | 'warn' | 'error'
  /** Шари, які можна виділити з повідомлення. */
  nodes?: string[]
}

export type ToUI =
  | { type: 'lang'; lang: Lang }
  | { type: 'busy'; busy: boolean; code?: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'analysis'; vm: AnalysisVM | null }
  | { type: 'notice'; notice: Notice }
  | { type: 'families'; families: string[] }
  | { type: 'family-styles'; family: string; styles: string[] }
  | { type: 'selection'; count: number }
