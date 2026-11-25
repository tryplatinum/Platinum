import type { AgentProposalKind, AgentProposalSource } from '../../shared/agent.js'
import type { Json } from '../../src/lib/database.types.js'
import type { AgentContext, CreatedProposal } from './types.js'

/**
 * Inserts a pending proposal with the service role, after the student has been
 * found with the counselor's own client in the counselor's firm. A student id
 * from anywhere else is refused before anything is written.
 */
export async function insertProposal(
  ctx: AgentContext,
  args: {
    kind: AgentProposalKind
    studentId: string
    payload: unknown
    rationale: string
    sources: AgentProposalSource[]
  },
): Promise<{ confirmation: string; proposal: CreatedProposal }> {
  if (ctx.studentId && args.studentId !== ctx.studentId) {
    throw new Error('This thread is for one student. Stay with that student, or open the general thread.')
  }
  const student = await ctx.user.from('students').select('id').eq('id', args.studentId).eq('firm_id', ctx.firmId).maybeSingle()
  if (student.error) {
    console.error('[agent] proposal student lookup failed:', student.error.message)
    throw new Error('Could not check that student. Nothing was saved.')
  }
  if (!student.data) throw new Error('That student is not in this firm. Nothing was saved.')

  const { data, error } = await ctx.service
    .from('agent_proposals')
    .insert({
      firm_id: ctx.firmId,
      student_id: student.data.id,
      thread_id: ctx.threadId,
      kind: args.kind,
      payload: args.payload as Json,
      rationale: args.rationale,
      sources: args.sources as unknown as Json,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[agent] proposal insert failed:', error?.message ?? 'no row')
    throw new Error('Could not save the proposal. Nothing was saved.')
  }
  const proposal: CreatedProposal = {
    id: data.id,
    kind: args.kind,
    studentId: args.studentId,
    rationale: args.rationale,
    sources: args.sources,
    payload: args.payload as Json,
  }
  ctx.createdProposals.push(proposal)
  return {
    confirmation: `Proposal saved for the counselor to review in Approvals (${args.kind}). id=${proposal.id}`,
    proposal,
  }
}
