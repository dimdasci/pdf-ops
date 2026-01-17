/**
 * Error types for the intelligent pipeline stages.
 *
 * Each stage (Layout Analysis, Structure Analysis, Content Extraction, Organization)
 * has a dedicated error type using Effect's Schema.TaggedError pattern for
 * type-safe error handling with exhaustive matching.
 */

import { Schema } from 'effect'

// =============================================================================
// Pass 1: Layout Analysis Errors
// =============================================================================

/**
 * Error during layout analysis pass.
 * Occurs when the LLM fails to identify page zones, repeated elements,
 * or decorative images.
 */
export class LayoutAnalysisError
  extends Schema.TaggedError<LayoutAnalysisError>()('LayoutAnalysisError', {
    message: Schema.String,
    pageNumber: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  })
{}

// =============================================================================
// Pass 2: Structure Analysis Errors
// =============================================================================

/**
 * Error during structure analysis pass.
 * Occurs when the LLM fails to extract TOC, heading hierarchy,
 * or section boundaries.
 */
export class StructureAnalysisError
  extends Schema.TaggedError<StructureAnalysisError>()('StructureAnalysisError', {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  })
{}

// =============================================================================
// Pass 3: Content Extraction Errors
// =============================================================================

/**
 * Error during content extraction pass.
 * Occurs when the LLM fails to extract sections, footnotes,
 * or images from specific pages.
 */
export class ContentExtractionError
  extends Schema.TaggedError<ContentExtractionError>()('ContentExtractionError', {
    message: Schema.String,
    pageNumber: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  })
{}

// =============================================================================
// Pass 4: Organization/Assembly Errors
// =============================================================================

/**
 * Error during organization/assembly pass.
 * Occurs when the LLM fails to assemble extracted content
 * into properly formatted markdown.
 */
export class OrganizationError
  extends Schema.TaggedError<OrganizationError>()('OrganizationError', {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  })
{}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Union of all intelligent pipeline errors for exhaustive handling.
 *
 * @example
 * ```typescript
 * pipe(
 *   pipelineEffect,
 *   Effect.catchTags({
 *     LayoutAnalysisError: (e) => handleLayoutError(e),
 *     StructureAnalysisError: (e) => handleStructureError(e),
 *     ContentExtractionError: (e) => handleContentError(e),
 *     OrganizationError: (e) => handleOrgError(e),
 *   })
 * )
 * ```
 */
export type IntelligentPipelineError =
  | LayoutAnalysisError
  | StructureAnalysisError
  | ContentExtractionError
  | OrganizationError
