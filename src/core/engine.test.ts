import test from 'node:test';
import assert from 'node:assert/strict';
import { AgencyStore, DomainError } from './store';
import {
  computeFinanceSummary,
  computeMilestoneProgress,
  getTomorrowInKolkata,
  normalizeLocationHub,
  resolveRequestAutoFill,
} from './rules';

// Fixed reference date: Saturday 21 Nov 2026 10:00 IST (04:30 UTC)
const SAT_21_NOV_2026_IST = new Date('2026-11-21T04:30:00.000Z');

test('AT-01: Tomorrow date default in Asia/Kolkata ignores chapter regular weekday (Thursday)', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const snap = store.getBootstrapPayload(sa);

  assert.equal(getTomorrowInKolkata(SAT_21_NOV_2026_IST), '2026-11-22');

  const amit = snap.members!.find((m) => m.id === 'mem-amit')!;
  const elegance = snap.chapters!.find((c) => c.id === 'chap-elegance')!;
  assert.equal(elegance.regularWeekday, 'Thursday');

  const auto = resolveRequestAutoFill(amit, snap.chapters!, snap.locations!, SAT_21_NOV_2026_IST);
  assert.ok(auto);
  assert.equal(auto.meetingDate, '2026-11-22'); // Sunday, NOT Thursday
  assert.equal(auto.chapterRegularWeekday, 'Thursday');
});

test('AT-02 & AT-03: Linked auto-fill populates venue/maps/intro/fee and request overrides never mutate master records', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const before = store.getBootstrapPayload(sa);
  const amitBefore = before.members!.find((m) => m.id === 'mem-amit')!;
  const chapBefore = before.chapters!.find((c) => c.id === 'chap-elegance')!;

  const { request } = store.createRequest(sa, {
    goingForMemberId: 'mem-amit',
    assignmentMode: 'MULTI_INTEREST',
    meetingDate: '2026-11-25', // Special override
    venueNameOverride: 'Festival Banquet Override',
    memberFee: 750,
    offeredPayout: 450,
  });

  assert.equal(request.meetingDate, '2026-11-25');
  assert.equal(request.venueNameSnapshot, 'Festival Banquet Override');
  assert.equal(request.chapterRegularWeekday, 'Thursday');
  assert.ok(request.mapsUrlSnapshot.includes('maps.google.com'));
  assert.equal(request.intro30SecSnapshot, amitBefore.intro30Sec);

  const after = store.getBootstrapPayload(sa);
  const amitAfter = after.members!.find((m) => m.id === 'mem-amit')!;
  const chapAfter = after.chapters!.find((c) => c.id === 'chap-elegance')!;
  assert.equal(amitAfter.standardFee, 500);
  assert.equal(chapAfter.regularWeekday, 'Thursday');
  assert.equal(chapAfter.defaultLocationId, chapBefore.defaultLocationId);
});

test('AT-04: Five interested candidates for capacity=1; selecting 1 marks the other 4 NOT_SELECTED', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const { request } = store.createRequest(sa, {
    goingForMemberId: 'mem-amit',
    assignmentMode: 'MULTI_INTEREST',
    positionsRequired: 1,
  });

  const subIds = ['usr-sub-surya', 'usr-sub-stuti', 'usr-sub-ravi', 'usr-sub-pooja', 'usr-sub-meera'];
  const respIds: string[] = [];
  for (const uid of subIds) {
    const subActor = store.resolveActiveActor('demo', uid);
    const { response } = store.submitResponse(subActor, request.id, { responseType: 'INTERESTED' });
    respIds.push(response.id);
  }

  const assignment = store.approveResponseAndConfirm(sa, respIds[1]); // Select Stuti
  assert.equal(assignment.contractSubstituteId, 'sub-stuti');

  const snap = store.getBootstrapPayload(sa);
  const reqResps = snap.responses!.filter((r) => r.requestId === request.id);
  assert.equal(reqResps.filter((r) => r.status === 'SELECTED').length, 1);
  assert.equal(reqResps.filter((r) => r.status === 'NOT_SELECTED').length, 4);

  // Attempting to confirm a second candidate for capacity=1 must fail
  assert.throws(
    () => store.approveResponseAndConfirm(sa, respIds[0]),
    (err: unknown) => err instanceof DomainError && err.code === 'CAPACITY_FULL'
  );
});

test('AT-05 & AT-06: Atomic First-Confirm locks single slot, while bids and guest delegations still require approval', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const { request } = store.createRequest(sa, {
    goingForMemberId: 'mem-rohit',
    meetingDate: '2026-11-29',
    assignmentMode: 'FIRST_CONFIRM',
    positionsRequired: 1,
    allowBids: true,
    offeredPayout: 350,
  });

  const surya = store.resolveActiveActor('demo', 'usr-sub-surya');
  const pooja = store.resolveActiveActor('demo', 'usr-sub-pooja');
  const stuti = store.resolveActiveActor('demo', 'usr-sub-stuti');
  const meera = store.resolveActiveActor('demo', 'usr-sub-meera');

  // Guest delegate on FIRST_CONFIRM must NOT auto-confirm
  const delRes = store.submitResponse(surya, request.id, {
    responseType: 'DELEGATE_PROPOSAL',
    delegatedGuestId: 'guest-aman',
  });
  assert.equal(delRes.autoConfirmed, false);
  assert.equal(delRes.response.status, 'AWAITING_APPROVAL');

  // Price bid on FIRST_CONFIRM must NOT auto-confirm
  const bidRes = store.submitResponse(pooja, request.id, {
    responseType: 'BID',
    proposedPayout: 425,
  });
  assert.equal(bidRes.autoConfirmed, false);
  assert.equal(bidRes.response.status, 'AWAITING_APPROVAL');

  // First eligible registered substitute confirms directly -> atomic lock succeeds!
  const firstConfirm = store.submitResponse(stuti, request.id, { responseType: 'FIRST_CONFIRM' });
  assert.equal(firstConfirm.autoConfirmed, true);
  assert.ok(firstConfirm.assignment);
  assert.equal(firstConfirm.assignment.contractSubstituteId, 'sub-stuti');

  // Second substitute attempting simultaneous First-Confirm must fail with conflict
  assert.throws(
    () => store.submitResponse(meera, request.id, { responseType: 'FIRST_CONFIRM' }),
    (err: unknown) => err instanceof DomainError && err.status === 409
  );
});

test('AT-07: Unconfirmed substitute public open request strips member identity, phone, and 30-sec intro', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const ravi = store.resolveActiveActor('demo', 'usr-sub-ravi');
  const payload = store.getBootstrapPayload(ravi);
  const openCard = payload.openRequests!.find((r) => r.id === 'req-tmrw-4')!;

  assert.ok(openCard);
  assert.equal(openCard.chapterName, 'BNI Titans');
  assert.ok(openCard.coordinatorCallingPhone.length > 0);
  assert.equal('memberName' in openCard, false);
  assert.equal('memberPhone' in openCard, false);
  assert.equal('intro30Sec' in openCard, false);
  assert.equal('addressSnapshot' in openCard, false);

  // Confirming unlocks full briefing in confirmedBriefings
  store.submitResponse(ravi, 'req-tmrw-4', { responseType: 'FIRST_CONFIRM' });
  const after = store.getBootstrapPayload(ravi);
  const briefing = after.confirmedBriefings!.find((b) => b.requestNumber === openCard.requestNumber);
  assert.ok(briefing);
  assert.equal(briefing.memberName, 'Rohit Sharma');
  assert.ok(briefing.intro30Sec.includes('Apex Logistics'));
});

test('AT-08, AT-09, AT-10, AT-11 & AT-13: Partner guest delegation, Reported by Partner, idempotent Finish, and exact margin (₹500 / ₹350 / ₹150)', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const surya = store.loginDemo('SUB'); // Partner Surya Menon

  // Add a saved guest contact once
  const newGuest = store.upsertPartnerGuestContact(surya, {
    name: 'Rohan Kulkarni',
    phone: '9844001122',
    homeArea: 'Andheri West',
    consentConfirmed: true,
  });
  assert.equal(newGuest.partnerSubstituteId, 'sub-surya');

  const { request } = store.createRequest(sa, {
    goingForMemberId: 'mem-amit', // ₹500 member fee
    assignmentMode: 'MULTI_INTEREST',
    memberFee: 500,
    offeredPayout: 350,
  });

  // Partner nominates saved guest
  const { response } = store.submitResponse(surya, request.id, {
    responseType: 'DELEGATE_PROPOSAL',
    delegatedGuestId: newGuest.id,
  });
  const assignment = store.approveResponseAndConfirm(sa, response.id);
  assert.equal(assignment.contractSubstituteId, 'sub-surya');
  assert.equal(assignment.payeeSubstituteId, 'sub-surya');
  assert.equal(assignment.actualAttendeeGuestId, newGuest.id);
  assert.equal(assignment.actualAttendeeName, 'Rohan Kulkarni');

  // Partner performs check-ins on behalf of guest
  const reached = store.recordCheckin(surya, assignment.id, 'REACHED');
  assert.equal(reached.lastCheckinReportedByPartner, true);

  // Partner taps Finish -> atomic exactly-once ledger creation
  const fin1 = store.finishAssignmentAtomic(surya, assignment.id, {
    idempotencyKey: 'idem-key-1',
    notes: { highlights: 'Great session by Rohan' },
  });
  assert.equal(fin1.idempotentReplay, false);
  assert.equal(fin1.assignment.status, 'COMPLETED_SELF_REPORTED');
  assert.equal(fin1.assignment.finishedReportedByPartner, true);
  assert.equal(fin1.clientCharge.amount, 500);
  assert.equal(fin1.substituteEarning.amount, 350);
  assert.equal(fin1.substituteEarning.payeeSubstituteId, 'sub-surya'); // Registered partner ONLY

  // Repeat Finish (double-tap / network retry) -> ZERO duplicates
  const fin2 = store.finishAssignmentAtomic(surya, assignment.id, {
    idempotencyKey: 'idem-key-1',
  });
  assert.equal(fin2.idempotentReplay, true);
  assert.equal(fin2.clientCharge.id, fin1.clientCharge.id);
  assert.equal(fin2.substituteEarning.id, fin1.substituteEarning.id);

  // Agency margin check: ₹500 - ₹350 = ₹150 (guest private payout is NOT an agency payable)
  const summary = computeFinanceSummary([fin1.clientCharge], [fin1.substituteEarning], [], []);
  assert.equal(summary.grossMarginBeforeBonus, 150);
});

test('AT-12, AT-14, AT-15 & AT-16: Dispute hold & adjustment, batch/partial settlement allocations, non-duplicated Appreciation Bonus, and Milestone exclusions', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const surya = store.loginDemo('SUB');

  // Open dispute on asgn-prev-2 -> places settlement ON_HOLD
  store.openDisputeAndHold(sa, 'asgn-prev-2', 'Reviewing late arrival note', true);
  assert.throws(
    () =>
      store.recordFreelancerPayout(sa, {
        payeeSubstituteId: 'sub-surya',
        amount: 350,
        paymentDate: '2026-11-21',
        method: 'UPI',
        reference: 'UPI-BLOCKED',
        allocations: [{ earningId: 'earn-2', amount: 350 }],
      }),
    (err: unknown) => err instanceof DomainError && err.code === 'EARNING_ON_HOLD'
  );

  // Verify resolves hold, then record partial payout + ₹100 Appreciation Bonus
  store.verifyAssignment(sa, 'asgn-prev-2');
  const pay1 = store.recordFreelancerPayout(sa, {
    payeeSubstituteId: 'sub-surya',
    amount: 200, // Partial against ₹350
    bonusAmount: 100,
    bonusMessage: 'Outstanding consistency',
    paymentDate: '2026-11-21',
    method: 'UPI',
    reference: 'UPI-SURYA-PARTIAL',
    allocations: [{ earningId: 'earn-2', amount: 200 }],
    idempotencyKey: 'bonus-retry-key',
  });
  assert.equal(pay1.idempotentReplay, false);
  assert.equal(pay1.payout.totalTransferred, 300);

  // Retry with same idempotencyKey -> no duplicate bonus or double payment
  const pay2 = store.recordFreelancerPayout(sa, {
    payeeSubstituteId: 'sub-surya',
    amount: 200,
    bonusAmount: 100,
    paymentDate: '2026-11-21',
    method: 'UPI',
    reference: 'UPI-SURYA-PARTIAL',
    allocations: [{ earningId: 'earn-2', amount: 200 }],
    idempotencyKey: 'bonus-retry-key',
  });
  assert.equal(pay2.idempotentReplay, true);

  // Overpayment blocked
  assert.throws(
    () =>
      store.recordFreelancerPayout(sa, {
        payeeSubstituteId: 'sub-surya',
        amount: 200, // Only ₹150 remains
        paymentDate: '2026-11-21',
        method: 'UPI',
        reference: 'UPI-OVER',
        allocations: [{ earningId: 'earn-2', amount: 200 }],
      }),
    (err: unknown) => err instanceof DomainError && err.code === 'OVERPAYMENT_BLOCKED'
  );

  // Member bill was NOT increased by appreciation bonus
  const snap = store.getBootstrapPayload(sa);
  const arjunCharge = snap.clientCharges!.find((c) => c.id === 'chg-2')!;
  assert.equal(arjunCharge.amount, 500);

  // Milestone excludes disputed (asgn-prev-4) and cancelled assignments
  const milestone = computeMilestoneProgress(snap.assignments!, surya.substituteId!);
  assert.equal(milestone.validCompletions, 2); // prev-1 + prev-2 (prev-4 is disputed)
});

test('AT-17, AT-18 & AT-22: Cross-coordinator isolation, demo/workspace isolation, and deactivated user denial', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const priyaEC = store.resolveActiveActor('demo', 'usr-ec-1');
  const vikramEC = store.resolveActiveActor('demo', 'usr-ec-2');

  const priyaSnap = store.getBootstrapPayload(priyaEC);
  const vikramSnap = store.getBootstrapPayload(vikramEC);

  // Priya cannot see Vikram's member Neha Kapoor or finances
  assert.equal(priyaSnap.members!.some((m) => m.id === 'mem-neha'), false);
  assert.equal(vikramSnap.members!.some((m) => m.id === 'mem-divya'), false);

  // Direct ID access attempt across coordinators denied
  assert.throws(
    () => store.getMemberById(priyaEC, 'mem-neha'),
    (err: unknown) => err instanceof DomainError && err.status === 403
  );

  // Demo vs Workspace namespace isolation
  const adminWs = store.bootstrapWorkspaceAdmin({
    email: 'owner@agency.example',
    password: 'StrongPassword123',
    displayName: 'Workspace Owner',
    callingPhone: '9820000111',
  });
  const wsSnap = store.getBootstrapPayload(adminWs);
  assert.equal(wsSnap.members!.length, 0); // Zero demo leakage into workspace

  // Deactivated user denied immediately (AT-22)
  const sa = store.loginDemo('SA');
  store.setUserActiveStatus(sa, 'usr-ec-1', false);
  assert.throws(
    () => store.resolveActiveActor('demo', 'usr-ec-1'),
    (err: unknown) => err instanceof DomainError && err.code === 'ACCOUNT_DEACTIVATED'
  );
});

test('P2-01: Partner Guest duplicate phone blocked (409), Reported-by-Partner audit text, and guest has zero login', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const surya = store.loginDemo('SUB'); // Partner Surya Menon (canManageNetwork = true)
  const stuti = store.resolveActiveActor('demo', 'usr-sub-stuti'); // Non-partner substitute

  // Non-partner substitute cannot save guest contacts
  assert.throws(
    () =>
      store.upsertPartnerGuestContact(stuti, {
        name: 'Blocked Guest',
        phone: '9800012345',
        homeArea: 'Powai',
        consentConfirmed: true,
      }),
    (err: unknown) => err instanceof DomainError && err.code === 'NETWORK_DISABLED'
  );

  // Partner saves a new guest inline
  const g1 = store.upsertPartnerGuestContact(surya, {
    name: 'Siddharth Joshi',
    phone: '+91 98223-34455',
    whatsappPhone: '9822334455',
    homeArea: 'Kandivali West',
    preferredAreas: 'Kandivali, Malad',
    notes: 'Available weekdays',
    consentConfirmed: true,
  });
  assert.equal(g1.partnerSubstituteId, 'sub-surya');

  // Same 10-digit normalized mobile rejected with 409 DUPLICATE_GUEST_PHONE
  assert.throws(
    () =>
      store.upsertPartnerGuestContact(surya, {
        name: 'Duplicate Siddharth',
        phone: '9822334455',
        homeArea: 'Malad',
        consentConfirmed: true,
      }),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'DUPLICATE_GUEST_PHONE'
  );

  // Guest does NOT exist as a login user in demo namespace
  assert.throws(
    () => store.loginWithPassword('demo', 'siddharth@agencyos.demo', 'Substitute@123'),
    (err: unknown) => err instanceof DomainError && err.status === 401
  );
});

test('P2-02: Provenance Examples A (₹0 commission on Assigned Via) vs B (explicit ₹50 approved commission on Finish)', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const priyaEC = store.resolveActiveActor('demo', 'usr-ec-1');
  const ravi = store.resolveActiveActor('demo', 'usr-sub-ravi');

  // External Coordinator CANNOT self-approve a coordinator commission
  assert.throws(
    () =>
      store.createRequest(priyaEC, {
        goingForMemberId: 'mem-divya',
        assignmentMode: 'MULTI_INTEREST',
        memberFee: 500,
        offeredPayout: 350,
        coordinatorCommissionEnabled: true,
        coordinatorCommissionAmount: 50,
      }),
    (err: unknown) => err instanceof DomainError && err.status === 403
  );

  // Example A: Assigned Via Priya, NO approved commission -> ₹0 commission booked, margin = ₹500 - ₹350 = ₹150
  const { request: reqA } = store.createRequest(sa, {
    goingForMemberId: 'mem-amit',
    meetingDate: '2026-11-26',
    assignmentMode: 'MULTI_INTEREST',
    memberFee: 500,
    offeredPayout: 350,
    sourcedViaCoordinatorId: 'coord-ec-1',
    receivedFromType: 'EXTERNAL_COORDINATOR',
    receivedFrom: 'Priya Nair via WhatsApp',
  });
  const { response: respA } = store.submitResponse(ravi, reqA.id, { responseType: 'INTERESTED' });
  const asgnA = store.approveResponseAndConfirm(sa, respA.id);
  assert.equal(asgnA.assignedViaCoordinatorId, 'coord-ec-1');
  assert.equal(asgnA.coordinatorCommissionAmount, 0);

  const finA = store.finishAssignmentAtomic(ravi, asgnA.id, { idempotencyKey: 'fin-ex-a' });
  assert.equal(finA.coordinatorCommission, undefined);
  const sumA = computeFinanceSummary([finA.clientCharge], [finA.substituteEarning], [], []);
  assert.equal(sumA.grossMarginBeforeBonus, 150);
  assert.equal(sumA.totalCoordinatorCommissions, 0);
  assert.equal(sumA.contributionAfterBonus, 150);

  // Example B: Explicit Super Admin ₹50 commission -> exactly 1 commission row on Finish, idempotent on replay, net = ₹100
  const { request: reqB } = store.createRequest(sa, {
    goingForMemberId: 'mem-amit',
    meetingDate: '2026-11-27',
    assignmentMode: 'MULTI_INTEREST',
    memberFee: 500,
    offeredPayout: 350,
    sourcedViaCoordinatorId: 'coord-ec-2',
    receivedFromType: 'EXTERNAL_COORDINATOR',
    receivedFrom: 'Vikram Joshi referral',
    coordinatorCommissionEnabled: true,
    coordinatorCommissionAmount: 50,
  });
  const { response: respB } = store.submitResponse(ravi, reqB.id, { responseType: 'INTERESTED' });
  const asgnB = store.approveResponseAndConfirm(sa, respB.id);
  assert.equal(asgnB.assignedViaCoordinatorId, 'coord-ec-2');
  assert.equal(asgnB.coordinatorCommissionAmount, 50);

  const finB1 = store.finishAssignmentAtomic(ravi, asgnB.id, { idempotencyKey: 'fin-ex-b' });
  assert.ok(finB1.coordinatorCommission);
  assert.equal(finB1.coordinatorCommission!.amount, 50);
  assert.equal(finB1.coordinatorCommission!.coordinatorId, 'coord-ec-2');

  // Replay Finish must NOT duplicate commission
  const finB2 = store.finishAssignmentAtomic(ravi, asgnB.id, { idempotencyKey: 'fin-ex-b' });
  assert.equal(finB2.idempotentReplay, true);
  assert.equal(finB2.coordinatorCommission!.id, finB1.coordinatorCommission!.id);

  const sumB = computeFinanceSummary(
    [finB1.clientCharge],
    [finB1.substituteEarning],
    [],
    [],
    [finB1.coordinatorCommission!]
  );
  assert.equal(sumB.grossMarginBeforeBonus, 150);
  assert.equal(sumB.totalCoordinatorCommissions, 50);
  assert.equal(sumB.contributionAfterBonus, 100);

  // External Coordinator cannot pay commission; Super Admin can
  assert.throws(
    () =>
      store.recordCoordinatorCommissionPayout(priyaEC, finB1.coordinatorCommission!.id, {
        amount: 50,
        paymentDate: '2026-11-27',
        method: 'UPI',
        reference: 'EC-BLOCKED',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 403
  );
  const paidComm = store.recordCoordinatorCommissionPayout(sa, finB1.coordinatorCommission!.id, {
    amount: 50,
    paymentDate: '2026-11-27',
    method: 'UPI',
    reference: 'UPI-COMM-50',
  });
  assert.equal(paidComm.status, 'FULLY_PAID');
  assert.equal(paidComm.paidAmount, 50);
});

test('P2-03: Replace Attendee preserves REPLACED history & assignedViaCoordinatorId; Cross-coordinator slot conflict blocked', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const priyaEC = store.resolveActiveActor('demo', 'usr-ec-1');
  const vikramEC = store.resolveActiveActor('demo', 'usr-ec-2');
  const stuti = store.resolveActiveActor('demo', 'usr-sub-stuti');
  const pooja = store.resolveActiveActor('demo', 'usr-sub-pooja');

  // Priya creates request for 2026-11-28 07:15 AM and confirms Stuti
  const { request: r1 } = store.createRequest(priyaEC, {
    goingForMemberId: 'mem-divya',
    meetingDate: '2026-11-28',
    reportingTime: '07:15 AM',
    assignmentMode: 'MULTI_INTEREST',
  });
  const { response: resp1 } = store.submitResponse(stuti, r1.id, { responseType: 'INTERESTED' });
  const asgn1 = store.approveResponseAndConfirm(priyaEC, resp1.id);
  assert.equal(asgn1.assignedViaCoordinatorId, 'coord-ec-1');

  // Vikram creates another request on same date + reportingTime -> Stuti cannot double-book via FIRST_CONFIRM
  const { request: r2 } = store.createRequest(vikramEC, {
    goingForMemberId: 'mem-neha',
    meetingDate: '2026-11-28',
    reportingTime: '07:15 AM',
    assignmentMode: 'FIRST_CONFIRM',
  });
  assert.throws(
    () => store.submitResponse(stuti, r2.id, { responseType: 'FIRST_CONFIRM' }),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'TIME_CONFLICT'
  );

  // Replace Stuti on r1 with Pooja -> old assignment marked REPLACED, new assignment preserves assignedViaCoordinatorId
  const { replacedAssignment, replacementAssignment } = store.replaceAssignmentAttendee(sa, asgn1.id, {
    reason: 'Substitute had a sudden travel change',
    replacementSubstituteId: 'sub-pooja',
  });
  assert.equal(replacedAssignment.status, 'REPLACED');
  assert.ok(replacementAssignment);
  assert.equal(replacementAssignment!.contractSubstituteId, 'sub-pooja');
  assert.equal(replacementAssignment!.replacedAssignmentId, asgn1.id);
  assert.equal(replacementAssignment!.assignedViaCoordinatorId, 'coord-ec-1');

  // Request Changes on a pending response resets status to PENDING with note
  const { response: resp2 } = store.submitResponse(pooja, r2.id, { responseType: 'BID', proposedPayout: 420 });
  const updatedResp = store.requestResponseChanges(vikramEC, resp2.id, 'Please confirm if ₹375 works');
  assert.equal(updatedResp.status, 'PENDING');
  assert.ok(updatedResp.note?.includes('Please confirm if ₹375 works'));
});

test('P2-04: Mumbai location hub normalization groups sub-areas cleanly', () => {
  assert.equal(normalizeLocationHub('Andheri West'), 'Andheri');
  assert.equal(normalizeLocationHub('Andheri East, Chakala'), 'Andheri');
  assert.equal(normalizeLocationHub('Kandivali West'), 'Kandivali');
  assert.equal(normalizeLocationHub('Goregaon East'), 'Goregaon');
  assert.equal(normalizeLocationHub('BKC / Bandra East'), 'Bandra / BKC');
  assert.equal(normalizeLocationHub('Powai Lake'), 'Powai');
});

test('P2-05: Super Admin exclusive controls (account creation with password, password reset, entity delete, clear transactions, demo reset) & negative RBAC', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const priyaEC = store.resolveActiveActor('demo', 'usr-ec-1');
  const suryaSub = store.loginDemo('SUB');

  // Negative RBAC: EC & SUB cannot create substitute accounts, reset passwords, delete entities, clear transactions, or reset demo
  for (const unauthorized of [priyaEC, suryaSub]) {
    assert.throws(
      () =>
        store.upsertSubstitute(unauthorized, {
          name: 'Unauth Sub',
          phone: '9911223344',
          email: 'unauth.sub@example.com',
          initialPassword: 'Password@123',
        }),
      (err: unknown) => err instanceof DomainError && err.status === 403
    );
    assert.throws(
      () => store.adminResetUserPassword(unauthorized, 'usr-sub-stuti', 'NewPass@123'),
      (err: unknown) => err instanceof DomainError && err.status === 403
    );
    assert.throws(
      () => store.deleteEntity(unauthorized, 'request', 'req-tmrw-1'),
      (err: unknown) => err instanceof DomainError && err.status === 403
    );
    assert.throws(
      () => store.clearTestingTransactions(unauthorized),
      (err: unknown) => err instanceof DomainError && err.status === 403
    );
    assert.throws(
      () => store.resetDemoAuthorized(unauthorized),
      (err: unknown) => err instanceof DomainError && err.status === 403
    );
  }

  // Super Admin creates a Substitute with initial password -> Substitute can sign in with it
  const { substitute, passwordConfigured } = store.upsertSubstitute(sa, {
    name: 'Nikhil Verma',
    phone: '9876501234',
    email: 'nikhil.sub@agencyos.demo',
    homeArea: 'Kandivali East',
    defaultPayout: 350,
    initialPassword: 'InitialPass@123',
  });
  assert.equal(passwordConfigured, true);
  const loggedIn1 = store.loginWithPassword('demo', 'nikhil.sub@agencyos.demo', 'InitialPass@123');
  assert.equal(loggedIn1.substituteId, substitute.id);

  // Super Admin resets password -> old password fails, new password succeeds
  const resetRes = store.adminResetUserPassword(sa, substitute.userId, 'RotatedPass@999');
  assert.equal(resetRes.passwordUpdated, true);
  assert.throws(
    () => store.loginWithPassword('demo', 'nikhil.sub@agencyos.demo', 'InitialPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 401
  );
  const loggedIn2 = store.loginWithPassword('demo', 'nikhil.sub@agencyos.demo', 'RotatedPass@999');
  assert.equal(loggedIn2.id, substitute.userId);

  // Super Admin deletes unused test substitute cleanly
  const delSub = store.deleteEntity(sa, 'substitute', substitute.id);
  assert.equal(delSub.deleted, true);

  // Super Admin cannot delete a member with active linked requests (referential guard), but CAN delete after clearing transactions
  assert.throws(
    () => store.deleteEntity(sa, 'member', 'mem-amit'),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'MEMBER_HAS_REQUESTS'
  );

  const cleared = store.clearTestingTransactions(sa);
  assert.ok(cleared.clearedRequests > 0);
  const afterClear = store.getBootstrapPayload(sa);
  assert.equal(afterClear.requests!.length, 0);
  assert.equal(afterClear.assignments!.length, 0);
  assert.ok(afterClear.members!.length > 0); // Masters preserved!

  // Now member deletion succeeds
  const delMem = store.deleteEntity(sa, 'member', 'mem-amit');
  assert.equal(delMem.deleted, true);

  // Super Admin resets demo sandbox -> seeded data restored
  store.resetDemoAuthorized(sa);
  const restored = store.getBootstrapPayload(sa);
  assert.ok(restored.requests!.length >= 5);
  assert.ok(restored.members!.some((m) => m.id === 'mem-amit'));
});
