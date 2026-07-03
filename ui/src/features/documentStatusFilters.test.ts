import { describe, expect, it } from 'vitest'
import {
  getStatusBucket,
  getStatusRequestFilters,
  matchesStatusFilter
} from './documentStatusFilters'

describe('document status filters', () => {
  it('keeps deprecated preprocessed documents visible in completed and parse buckets', () => {
    expect(getStatusBucket('preprocessed')).toBe('completed')
    expect(matchesStatusFilter('preprocessed', 'completed')).toBe(true)
    expect(getStatusRequestFilters('completed')).toEqual({
      status_filters: ['processed', 'preprocessed']
    })
    expect(getStatusRequestFilters('parse')).toEqual({
      status_filters: ['parsing', 'pending', 'preprocessed']
    })
  })

  it('uses single status_filter for one-to-one buckets', () => {
    expect(getStatusRequestFilters('analyze')).toEqual({ status_filter: 'analyzing' })
    expect(getStatusRequestFilters('process')).toEqual({ status_filter: 'processing' })
    expect(getStatusRequestFilters('failed')).toEqual({ status_filter: 'failed' })
    expect(getStatusRequestFilters('all')).toEqual({})
  })
})
