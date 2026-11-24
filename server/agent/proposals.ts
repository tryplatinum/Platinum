import type { AgentProposalKind, AgentProposalSource } from '../../shared/agent.js'
import type { Json } from '../../src/lib/database.types.js'
import type { AgentContext, CreatedProposal } from './types.js'

/** Inserts a pending proposal with the service role. Returns a short confirmation for the model. */
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
  const { data, error } = await ctx.service
    .from('agent_proposals')
    .insert({
      firm_id: ctx.firmId,
      student_id: args.studentId,
      thread_id: ctx.threadId,
      kind: args.kind,
      payload: args.payload as Json,
      rationale: args.rationale,
      sources: args.sources as unknown as Json,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Could not save the proposal.')
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
