export interface ScaleOption {
  label: string
  value: number | string
  score: number
}

export interface ScaleQuestion {
  id: string | number
  text: string
  subText?: string
  options: ScaleOption[]
  reverse?: boolean
  dimension?: string
  skipLogic?: {
    condition: string
    target: string
  }
}

export interface ScaleDimension {
  name: string
  questionIds: (string | number)[]
  formula?: string
  // MMPI 专属属性
  label?: string
  kWeight?: number
  yesQuestions?: (string | number)[]
  noQuestions?: (string | number)[]
}

export interface ScaleScoring {
  type: 'sum' | 'average' | 'weighted' | 'formula' | 'mmpi'
  formula?: string
  dimensions?: ScaleDimension[]
  mmpiConfig?: any
}

export interface ScaleCutoff {
  min?: number
  max?: number
  label: string
  severity: 'none' | 'mild' | 'moderate' | 'severe' | 'critical'
  color: string
  description: string
  suggestion?: string
}

export interface ScaleInterpretation {
  type: 'cutoff' | 'percentile' | 'profile' | 'mmpi_profile'
  cutoffs?: ScaleCutoff[]
  mmpiProfile?: any
}

export interface ScaleSettings {
  allowBacktrack: boolean
  allowSkip: boolean
  timeLimit?: number
  minAnsweredPercent: number
  randomizeOrder: boolean
}

export interface ReportSection {
  type: string
  config?: Record<string, any>
}

export interface ScaleDefinition {
  id: string
  age_range?: { min: number; max: number }
  name: string
  name_en?: string
  description: string
  version: string
  category: 'mood' | 'personality' | 'psychiatric' | 'cognitive' | 'screening' | 'other'
  tags: string[]
  targetPopulation?: {
    minAge?: number
    maxAge?: number
    gender?: 'male' | 'female' | 'any'
  }
  questions: ScaleQuestion[]
  scoring: ScaleScoring
  interpretation: ScaleInterpretation
  settings: ScaleSettings
  reportTemplate: {
    title: string
    sections: ReportSection[]
  }
  _filePath?: string
  _fileName?: string
  _enabled?: boolean
}

export interface AnswerRecord {
  questionId: string | number
  value: number | string
  score: number
}

export interface TestResult {
  scaleId: string
  scaleName: string
  userId: number | null
  rawScore: number
  stdScore: number
  dimensionScores?: Record<string, number>
  answers: AnswerRecord[]
  duration: number
  interpretation?: ScaleCutoff
  warnings?: string[]
}

export interface User {
  id: number
  name: string
  gender?: string
  birthdate?: string
  contact?: string
  notes?: string
  tags?: string // JSON string for string[]
  created_at?: string
}

export interface TestHistory {
  id: number
  user_id: number
  scale_id: string
  scale_name: string
  raw_score: number
  std_score: number
  result_json: string
  duration_seconds: number
  doctorNote?: string
  reportDoctor?: string
  operatorName?: string
  created_at: string
}
