import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgencyStore,
  DEFAULT_SUPER_ADMIN_EMAIL,
  DomainError,
  LOGIN_LOCKOUT_MS,
  RESET_TOKEN_TTL_MS,
} from './store';
import { isSmtpConfigured } from './mailer';
import {
  buildCoordinatorUpdateWhatsAppText,
  buildMemberCheckinWhatsAppText,
  buildMemberConfirmationWhatsAppText,
  buildMemberReminderWhatsAppText,
  buildOpenRequestHelpWhatsAppText,
  buildPayoutSummaryWhatsAppText,
  buildReachedPhotoWhatsAppText,
  buildReferralAskWhatsAppText,
  buildTeamAvailabilityWhatsAppText,
  computeAdminQuickSummary,
  computeFinanceSummary,
  computeMilestoneProgress,
  filterChapterAndMemberMatches,
  getMemberNoteTypeLabel,
  getTomorrowInKolkata,
  normalizeLocationHub,
  resolveNotificationDestination,
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

  // Confirming unlocks meeting instructions & venue in confirmedBriefings, NEVER member identity/business/contact
  store.submitResponse(ravi, 'req-tmrw-4', { responseType: 'FIRST_CONFIRM' });
  const after = store.getBootstrapPayload(ravi);
  const briefing = after.confirmedBriefings!.find((b) => b.requestNumber === openCard.requestNumber);
  assert.ok(briefing);
  assert.equal('memberName' in briefing, false);
  assert.equal('memberBusiness' in briefing, false);
  assert.equal('memberPhone' in briefing, false);
  assert.ok(briefing.intro30Sec.includes('Apex Logistics'));
  assert.ok(briefing.coordinatorCallingPhone.length > 0);
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

  // Public Super Admin signup is permanently disabled (403); Workspace is strictly isolated from Demo
  assert.throws(
    () =>
      store.bootstrapWorkspaceAdmin({
        email: 'owner@agency.example',
        password: 'StrongPassword123',
        displayName: 'Workspace Owner',
        callingPhone: '9820000111',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === 'PUBLIC_ADMIN_SIGNUP_DISABLED'
  );
  const wsStore = new AgencyStore(() => SAT_21_NOV_2026_IST, {
    superAdminPassword: 'StrongPassword123',
  });
  const adminWs = wsStore.loginWorkspace(DEFAULT_SUPER_ADMIN_EMAIL, 'StrongPassword123');
  assert.equal(adminWs.role, 'SUPER_ADMIN');
  assert.equal(adminWs.email, DEFAULT_SUPER_ADMIN_EMAIL);
  const wsSnap = wsStore.getBootstrapPayload(adminWs);
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

test('P3-01: Sole Super Admin locked to kishanus03@gmail.com; public admin signup disabled; only Super Admin creates accounts', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST, {
    superAdminPassword: 'SuperSecretPassword!1',
  });
  assert.equal(store.getSuperAdminEmail(), 'kishanus03@gmail.com');
  assert.equal(store.isSuperAdminPasswordConfigured(), true);

  // Public bootstrap admin signup permanently rejected
  assert.throws(
    () =>
      store.bootstrapWorkspaceAdmin({
        email: 'intruder@example.com',
        password: 'Password@123',
        displayName: 'Intruder',
        callingPhone: '9999999999',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 403 && err.code === 'PUBLIC_ADMIN_SIGNUP_DISABLED'
  );

  // Locked Super Admin logs in and creates an External Coordinator
  const wsAdmin = store.loginWorkspace('  KISHANUS03@GMAIL.COM ', 'SuperSecretPassword!1');
  assert.equal(wsAdmin.role, 'SUPER_ADMIN');
  assert.equal(wsAdmin.email, 'kishanus03@gmail.com');

  const invite = store.inviteUser(wsAdmin, {
    email: 'coord1@agency.in',
    displayName: 'Meera Coordinator',
    role: 'EXTERNAL_COORDINATOR',
    phone: '9820111222',
  });
  assert.ok(invite.userId);
  assert.ok(invite.inviteToken);

  // Accept invite sets password and logs in as EC
  const ecUser = store.acceptInvite('coord1@agency.in', invite.inviteToken!, 'CoordPass@123');
  assert.equal(ecUser.role, 'EXTERNAL_COORDINATOR');
  assert.equal(ecUser.email, 'coord1@agency.in');

  // External Coordinator cannot invite other users or reset passwords
  assert.throws(
    () =>
      store.inviteUser(ecUser, {
        email: 'another@agency.in',
        displayName: 'Blocked User',
        role: 'SUBSTITUTE',
        phone: '9820111333',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 403
  );
  assert.throws(
    () => store.adminResetUserPassword(ecUser, wsAdmin.id, 'HackPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 403
  );
});

test('P3-02: Global unique login email enforcement across create & edit (case/whitespace normalized) + Super Admin email reservation', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const surya = store.loginDemo('SUB');
  const priya = store.loginDemo('EC');

  // Duplicate email across case & whitespace rejected on inviteUser
  assert.throws(
    () =>
      store.inviteUser(sa, {
        email: `  ${surya.email.toUpperCase()}  `,
        displayName: 'Duplicate Surya',
        role: 'EXTERNAL_COORDINATOR',
        phone: '9820001122',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'EMAIL_EXISTS'
  );

  // Duplicate email rejected on upsertSubstitute create
  assert.throws(
    () =>
      store.upsertSubstitute(sa, {
        name: 'Duplicate Sub',
        phone: '9820001199',
        email: priya.email.toUpperCase(),
        initialPassword: 'Password@123',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'EMAIL_EXISTS'
  );

  // Reserved Super Admin email rejected for non-Super-Admin account
  assert.throws(
    () =>
      store.upsertSubstitute(sa, {
        name: 'Spoof Admin',
        phone: '9820001188',
        email: 'Kishanus03@gmail.com',
        initialPassword: 'Password@123',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'EMAIL_RESERVED'
  );

  // Missing or invalid email rejected on substitute create
  assert.throws(
    () =>
      store.upsertSubstitute(sa, {
        name: 'No Email Sub',
        phone: '9820001177',
        email: '',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'INVALID_EMAIL'
  );

  // Create two distinct substitutes, then try to edit sub2 to use sub1's email -> 409 EMAIL_EXISTS
  const { substitute: sub1 } = store.upsertSubstitute(sa, {
    name: 'Unique Sub One',
    phone: '9811100001',
    email: 'unique.one@agencyos.demo',
    initialPassword: 'Password@123',
  });
  const { substitute: sub2 } = store.upsertSubstitute(sa, {
    name: 'Unique Sub Two',
    phone: '9811100002',
    email: 'unique.two@agencyos.demo',
    initialPassword: 'Password@123',
  });

  assert.throws(
    () =>
      store.upsertSubstitute(sa, {
        id: sub2.id,
        name: 'Unique Sub Two',
        phone: '9811100002',
        email: '  UNIQUE.ONE@agencyos.demo ',
      }),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'EMAIL_EXISTS'
  );

  // Editing sub1 keeping its own email succeeds
  const updatedSub1 = store.upsertSubstitute(sa, {
    id: sub1.id,
    name: 'Unique Sub One Updated',
    phone: '9811100001',
    email: 'UNIQUE.ONE@agencyos.demo',
  });
  assert.equal(updatedSub1.substitute.email, 'unique.one@agencyos.demo');
});

test('P3-03: 5 failed password attempts trigger 15-minute lockout (429), auto-unlock after 15m, and unlock on reset', () => {
  let nowMs = SAT_21_NOV_2026_IST.getTime();
  const store = new AgencyStore(() => new Date(nowMs), {
    superAdminPassword: 'CorrectPassword@123',
  });

  // Attempts 1..4 -> 401 with decrementing remaining attempts
  for (let i = 1; i <= 4; i++) {
    assert.throws(
      () => store.loginWorkspace(DEFAULT_SUPER_ADMIN_EMAIL, `WrongPass#${i}`),
      (err: unknown) =>
        err instanceof DomainError &&
        err.status === 401 &&
        err.code === 'INVALID_CREDENTIALS' &&
        err.message.includes(`${5 - i} attempt`)
    );
  }

  // Attempt 5 -> 429 ACCOUNT_LOCKED with ~900s retryAfterSeconds
  assert.throws(
    () => store.loginWorkspace(DEFAULT_SUPER_ADMIN_EMAIL, 'WrongPass#5'),
    (err: unknown) =>
      err instanceof DomainError &&
      err.status === 429 &&
      err.code === 'ACCOUNT_LOCKED' &&
      (err.retryAfterSeconds ?? 0) >= 899
  );

  // Even the CORRECT password is blocked during the 15-minute lockout window
  nowMs += 5 * 60 * 1000; // +5 minutes
  assert.throws(
    () => store.loginWorkspace(DEFAULT_SUPER_ADMIN_EMAIL, 'CorrectPassword@123'),
    (err: unknown) =>
      err instanceof DomainError &&
      err.status === 429 &&
      err.code === 'ACCOUNT_LOCKED' &&
      (err.retryAfterSeconds ?? 0) >= 599
  );

  // Advance past 15-minute lockout -> login succeeds with correct password
  nowMs += LOGIN_LOCKOUT_MS;
  const session = store.loginWorkspace(DEFAULT_SUPER_ADMIN_EMAIL, 'CorrectPassword@123');
  assert.equal(session.email, DEFAULT_SUPER_ADMIN_EMAIL);

  // Lock Surya's real demo account, then verify Super Admin password reset clears lockout immediately
  const sa = store.loginDemo('SA');
  const surya = store.loginDemo('SUB');
  for (let i = 1; i <= 5; i++) {
    assert.throws(() => store.loginWithPassword('demo', surya.email, 'BadPass'));
  }
  assert.throws(
    () => store.loginWithPassword('demo', surya.email, 'Demo@12345'),
    (err: unknown) => err instanceof DomainError && err.status === 429 && err.code === 'ACCOUNT_LOCKED'
  );
  store.adminResetUserPassword(sa, surya.id, 'FreshSubPass@123');
  const unlockedSub = store.loginWithPassword('demo', surya.email, 'FreshSubPass@123');
  assert.equal(unlockedSub.id, surya.id);
});

test('P3-04: Super Admin email password reset flow (sole email, 15m TTL, 5-guess code invalidation, rate limit, SMTP config check)', () => {
  let nowMs = SAT_21_NOV_2026_IST.getTime();
  const store = new AgencyStore(() => new Date(nowMs));

  // Before initial password is set, Super Admin cannot log in until reset via email
  assert.equal(store.isSuperAdminPasswordConfigured(), false);
  assert.throws(
    () => store.loginWorkspace(DEFAULT_SUPER_ADMIN_EMAIL, 'Anything@123'),
    (err: unknown) => err instanceof DomainError && err.status === 401
  );

  // Non-Super-Admin email does NOT dispatch an email and exposes no code
  const nonAdminReq = store.requestSuperAdminPasswordReset('other.user@example.com');
  assert.equal(nonAdminReq.shouldSendEmail, false);
  assert.equal(nonAdminReq.resetCode, undefined);

  // Super Admin requests reset -> generates 8-char code for SMTP delivery only
  const req1 = store.requestSuperAdminPasswordReset('  Kishanus03@gmail.com ');
  assert.equal(req1.shouldSendEmail, true);
  assert.equal(req1.toEmail, 'kishanus03@gmail.com');
  assert.ok(req1.resetCode && req1.resetCode.length === 8);

  // Rollback clears pending token if SMTP delivery fails
  store.rollbackPendingPasswordReset('kishanus03@gmail.com');
  assert.throws(
    () => store.completePasswordReset('kishanus03@gmail.com', req1.resetCode!, 'NewStrongPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'INVALID_TOKEN'
  );

  // Request a fresh code and test 5 failed code guesses -> invalidates token with 429
  const req2 = store.requestSuperAdminPasswordReset('kishanus03@gmail.com');
  for (let i = 1; i <= 4; i++) {
    assert.throws(
      () => store.completePasswordReset('kishanus03@gmail.com', 'WRONGCOD', 'NewStrongPass@123'),
      (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'INVALID_TOKEN'
    );
  }
  assert.throws(
    () => store.completePasswordReset('kishanus03@gmail.com', 'WRONGCOD', 'NewStrongPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 429 && err.code === 'RESET_CODE_INVALIDATED'
  );
  // Even the real req2 code is now dead
  assert.throws(
    () => store.completePasswordReset('kishanus03@gmail.com', req2.resetCode!, 'NewStrongPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'INVALID_TOKEN'
  );

  // Test 15-minute code expiration
  const req3 = store.requestSuperAdminPasswordReset('kishanus03@gmail.com');
  nowMs += RESET_TOKEN_TTL_MS + 1000;
  assert.throws(
    () => store.completePasswordReset('kishanus03@gmail.com', req3.resetCode!, 'NewStrongPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'TOKEN_EXPIRED'
  );

  // Fresh window: request code, complete reset, and sign in cleanly (even if previously locked)
  const req4 = store.requestSuperAdminPasswordReset('kishanus03@gmail.com');
  store.completePasswordReset(
    'kishanus03@gmail.com',
    req4.resetCode!.toLowerCase(), // case-insensitive code entry
    'KishanNewPass@2026'
  );
  assert.equal(store.isSuperAdminPasswordConfigured(), true);

  // Single-use: replaying the same code fails
  assert.throws(
    () => store.completePasswordReset('kishanus03@gmail.com', req4.resetCode!, 'AnotherPass@2026'),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'INVALID_TOKEN'
  );

  // Sign in with new password works
  const loggedIn = store.loginWorkspace('kishanus03@gmail.com', 'KishanNewPass@2026');
  assert.equal(loggedIn.role, 'SUPER_ADMIN');
  assert.equal(loggedIn.email, 'kishanus03@gmail.com');

  // Rate limit: 5 requests within 15 minutes allowed, 6th throws 429
  for (let i = 0; i < 4; i++) {
    store.requestSuperAdminPasswordReset('kishanus03@gmail.com');
  }
  assert.throws(
    () => store.requestSuperAdminPasswordReset('kishanus03@gmail.com'),
    (err: unknown) => err instanceof DomainError && err.status === 429 && err.code === 'TOO_MANY_RESET_REQUESTS'
  );

  // SMTP configuration helper returns false when SMTP_USER / SMTP_PASS are absent
  assert.equal(isSmtpConfigured({}), false);
  assert.equal(
    isSmtpConfigured({ SMTP_USER: 'kishanus03@gmail.com', SMTP_PASS: 'app-password-16ch' }),
    true
  );
});

test('P4-01: Self-service updateMyProfile & changeOwnPassword enforce validation, self-scoping, and scrypt verification', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST, {
    superAdminPassword: 'InitialAdminPass@2026',
  });
  const sa = store.loginWorkspace('kishanus03@gmail.com', 'InitialAdminPass@2026');

  // Create an External Coordinator and a Substitute in workspace
  const coordInvite = store.inviteUser(sa, {
    role: 'EXTERNAL_COORDINATOR',
    displayName: 'Meera Kapoor',
    email: 'meera.coord@example.com',
    phone: '9820001122',
    regionOrArea: 'Andheri',
    initialPassword: 'CoordPass@123',
  });
  assert.equal(coordInvite.passwordConfigured, true);

  const subRes = store.upsertSubstitute(sa, {
    name: 'Arjun Mehta',
    email: 'arjun.sub@example.com',
    phone: '9820003344',
    homeArea: 'Powai',
    initialPassword: 'SubPass@123',
  });
  assert.equal(subRes.passwordConfigured, true);

  // Coordinator updates own profile & defaults
  const meera = store.loginWorkspace('meera.coord@example.com', 'CoordPass@123');
  const updatedCoord = store.updateMyProfile(meera, {
    displayName: 'Meera K.',
    callingPhone: '9811112222',
    whatsappPhone: '9811113333',
    region: 'Bandra / BKC',
    defaultMemberFee: 600,
    defaultSubstitutePayout: 400,
  });
  assert.equal(updatedCoord.user.displayName, 'Meera K.');
  assert.equal(updatedCoord.profile.callingPhone, '9811112222');
  assert.equal(updatedCoord.profile.whatsappPhone, '9811113333');
  assert.equal(updatedCoord.profile.defaultMemberFee, 600);
  assert.equal(updatedCoord.profile.defaultSubstitutePayout, 400);

  // Negative fee rejected
  assert.throws(
    () => store.updateMyProfile(meera, { defaultMemberFee: -50 }),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'VALIDATION_ERROR'
  );

  // Substitute updates own availability, UPI, homeArea, emergency consent
  const arjun = store.loginWorkspace('arjun.sub@example.com', 'SubPass@123');
  const updatedSub = store.updateMyProfile(arjun, {
    homeArea: 'Andheri West',
    availability: 'LIMITED',
    emergencyConsent: true,
    upiReference: 'arjun@okicici',
  });
  assert.equal(updatedSub.profile.homeArea, 'Andheri West');
  assert.equal(updatedSub.profile.availability, 'LIMITED');
  assert.equal(updatedSub.profile.emergencyConsent, true);
  assert.equal(updatedSub.profile.upiReference, 'arjun@okicici');

  // Bootstrap includes synced myProfile
  const subBoot = store.getBootstrapPayload(updatedSub.user);
  assert.equal(subBoot.myProfile.availability, 'LIMITED');
  assert.equal(subBoot.myProfile.upiReference, 'arjun@okicici');

  // Self-service password change: wrong current password rejected with 401
  assert.throws(
    () => store.changeOwnPassword(meera, 'WrongPass@123', 'NewCoordPass@456'),
    (err: unknown) => err instanceof DomainError && err.status === 401 && err.code === 'INVALID_CURRENT_PASSWORD'
  );

  // Same password rejected with 400
  assert.throws(
    () => store.changeOwnPassword(meera, 'CoordPass@123', 'CoordPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'SAME_PASSWORD'
  );

  // Short password rejected with 400
  assert.throws(
    () => store.changeOwnPassword(meera, 'CoordPass@123', 'short'),
    (err: unknown) => err instanceof DomainError && err.status === 400 && err.code === 'WEAK_PASSWORD'
  );

  // Valid password change works and invalidates old password
  store.changeOwnPassword(meera, 'CoordPass@123', 'NewCoordPass@456');
  assert.throws(
    () => store.loginWorkspace('meera.coord@example.com', 'CoordPass@123'),
    (err: unknown) => err instanceof DomainError && err.status === 401
  );
  const relogged = store.loginWorkspace('meera.coord@example.com', 'NewCoordPass@456');
  assert.equal(relogged.displayName, 'Meera K.');
});

test('P4-02: 3-character Chapter/Member typeahead threshold & Admin Quick Summary metrics', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const snap = store.getBootstrapPayload(sa);

  // Under 3 characters -> strictly not ready and returns empty matches
  const zero = filterChapterAndMemberMatches('', snap.chapters!, snap.members!);
  assert.equal(zero.ready, false);
  assert.equal(zero.chapters.length, 0);
  assert.equal(zero.members.length, 0);

  const two = filterChapterAndMemberMatches('am', snap.chapters!, snap.members!);
  assert.equal(two.ready, false);
  assert.equal(two.members.length, 0);

  // 3+ characters -> matching chapters & members appear
  const threeMem = filterChapterAndMemberMatches('ami', snap.chapters!, snap.members!);
  assert.equal(threeMem.ready, true);
  assert.ok(threeMem.members.some((m) => m.member.name.toLowerCase().includes('amit')));

  const threeChap = filterChapterAndMemberMatches('ele', snap.chapters!, snap.members!);
  assert.equal(threeChap.ready, true);
  assert.ok(threeChap.chapters.some((c) => c.name.toLowerCase().includes('elegance')));

  // Quick Summary returns accurate non-negative priority metrics
  const qs = computeAdminQuickSummary({
    today: snap.today,
    tomorrow: snap.tomorrow,
    requests: snap.requests!,
    assignments: snap.assignments!,
    responses: snap.responses!,
    clientCharges: snap.clientCharges!,
    substituteEarnings: snap.substituteEarnings!,
  });
  assert.ok(qs.pendingRequestsCount >= 0);
  assert.ok(qs.unfilledPositionsCount >= 0);
  assert.ok(qs.outstandingInvoicesAmount >= 0);
  assert.ok(qs.outstandingInvoicesCount >= 0);
});

test('P4-03: Check-in updates (AWAKE / REACHED) and Issue alerts notify BOTH assigning External Coordinator AND Super Admin', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const priyaEC = store.resolveActiveActor('demo', 'usr-ec-1');
  const stuti = store.resolveActiveActor('demo', 'usr-sub-stuti');

  // External Coordinator Priya creates a request and confirms Stuti
  const { request } = store.createRequest(priyaEC, {
    goingForMemberId: 'mem-divya',
    meetingDate: '2026-11-29',
    reportingTime: '07:15 AM',
    assignmentMode: 'MULTI_INTEREST',
  });
  const { response } = store.submitResponse(stuti, request.id, { responseType: 'INTERESTED' });
  const asgn = store.approveResponseAndConfirm(priyaEC, response.id);

  // Stuti marks AWAKE and REACHED
  store.recordCheckin(stuti, asgn.id, 'AWAKE');
  store.recordCheckin(stuti, asgn.id, 'REACHED');

  // Both Priya (assigning EC) and Super Admin must receive REACHED notifications
  const saBoot = store.getBootstrapPayload(sa);
  const ecBoot = store.getBootstrapPayload(priyaEC);

  assert.ok(
    saBoot.notifications.some(
      (n) => n.category === 'CHECKIN' && n.title.includes('Reached Venue') && n.body.includes(request.chapterNameSnapshot)
    ),
    'Super Admin must receive Reached check-in notification'
  );
  assert.ok(
    ecBoot.notifications.some(
      (n) => n.category === 'CHECKIN' && n.title.includes('Reached Venue') && n.body.includes(request.chapterNameSnapshot)
    ),
    'Assigning External Coordinator must receive Reached check-in notification'
  );

  // Issue report notifies both too
  store.reportAssignmentIssue(stuti, asgn.id, 'Heavy rain near Andheri metro');
  const saAfterIssue = store.getBootstrapPayload(sa);
  const ecAfterIssue = store.getBootstrapPayload(priyaEC);
  assert.ok(
    saAfterIssue.notifications.some((n) => n.category === 'ISSUE' && n.body.includes('Heavy rain')),
    'Super Admin must receive issue alert'
  );
  assert.ok(
    ecAfterIssue.notifications.some((n) => n.category === 'ISSUE' && n.body.includes('Heavy rain')),
    'Assigning External Coordinator must receive issue alert'
  );
});

test('P4-04: Same-date Cross-Meeting protection blocks auto-accept, pins to Super Admin, blocks EC approval, allows Super Admin approval', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const priyaEC = store.resolveActiveActor('demo', 'usr-ec-1');
  const vikramEC = store.resolveActiveActor('demo', 'usr-ec-2');
  const stuti = store.resolveActiveActor('demo', 'usr-sub-stuti');

  // 1. Priya confirms Stuti for 2026-12-03 at 07:15 AM
  const { request: r1 } = store.createRequest(priyaEC, {
    goingForMemberId: 'mem-divya',
    meetingDate: '2026-12-03',
    reportingTime: '07:15 AM',
    assignmentMode: 'MULTI_INTEREST',
  });
  const { response: resp1 } = store.submitResponse(stuti, r1.id, { responseType: 'INTERESTED' });
  store.approveResponseAndConfirm(priyaEC, resp1.id);

  // 2. Vikram creates a SECOND request on the SAME DATE (2026-12-03) even at a different time (08:30 AM)
  const { request: r2 } = store.createRequest(vikramEC, {
    goingForMemberId: 'mem-neha',
    meetingDate: '2026-12-03',
    reportingTime: '08:30 AM',
    assignmentMode: 'FIRST_CONFIRM',
  });

  // 3. Stuti sees sameDateSelfConflict on r2 in her Open Requests feed
  const stutiBoot = store.getBootstrapPayload(stuti);
  const r2Card = stutiBoot.openRequests!.find((c) => c.id === r2.id);
  assert.ok(r2Card?.sameDateSelfConflict, 'Open request card must expose sameDateSelfConflict');
  assert.equal(r2Card!.sameDateSelfConflict!.chapterName, r1.chapterNameSnapshot);

  // 4. Raw FIRST_CONFIRM is rejected with 409 TIME_CONFLICT
  assert.throws(
    () => store.submitResponse(stuti, r2.id, { responseType: 'FIRST_CONFIRM' }),
    (err: unknown) => err instanceof DomainError && err.status === 409 && err.code === 'TIME_CONFLICT'
  );

  // 5. Submitting with requestCrossMeeting: true creates a pinned AWAITING_APPROVAL cross-meeting request for Super Admin
  const crossRes = store.submitResponse(stuti, r2.id, {
    responseType: 'INTERESTED',
    requestCrossMeeting: true,
  });
  assert.equal(crossRes.autoConfirmed, false);
  assert.equal(crossRes.crossMeetingPending, true);
  assert.equal(crossRes.response.isCrossMeetingRequest, true);
  assert.equal(crossRes.response.status, 'AWAITING_APPROVAL');

  const saNotifs = store.getBootstrapPayload(sa).notifications;
  assert.ok(
    saNotifs.some((n) => n.title.includes('Pinned Cross-Meeting Request')),
    'Super Admin must receive pinned Cross-Meeting notification'
  );

  // 6. External Coordinator Vikram CANNOT approve the cross-meeting (403 CROSS_MEETING_SUPER_ADMIN_ONLY)
  assert.throws(
    () => store.approveResponseAndConfirm(vikramEC, crossRes.response.id),
    (err: unknown) =>
      err instanceof DomainError && err.status === 403 && err.code === 'CROSS_MEETING_SUPER_ADMIN_ONLY'
  );

  // 7. Super Admin CAN approve the cross-meeting -> confirmed with isCrossMeeting === true
  const crossAsgn = store.approveResponseAndConfirm(sa, crossRes.response.id);
  assert.equal(crossAsgn.isCrossMeeting, true);
  assert.equal(crossAsgn.crossMeetingApprovedByUserId, sa.id);
  assert.equal(crossAsgn.status, 'CONFIRMED');
});

test('P4-05: Strict Veloctive Team privacy — substitutes receive instructions & coordinator contact ONLY, never member identity, phone, or business', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const surya = store.loginDemo('SUB');

  const saSnap = store.getBootstrapPayload(sa);
  const subSnap = store.getBootstrapPayload(surya);

  // Confirm member phone numbers & email NEVER appear anywhere in substitute bootstrap payload
  const subJson = JSON.stringify(subSnap);
  for (const member of saSnap.members!) {
    if (member.phone) {
      assert.equal(subJson.includes(member.phone), false, `Leaked member phone for ${member.name}`);
    }
    if (member.whatsappPhone) {
      assert.equal(subJson.includes(member.whatsappPhone), false, `Leaked member WhatsApp phone for ${member.name}`);
    }
    if (member.email) {
      assert.equal(subJson.includes(member.email), false, `Leaked member email for ${member.name}`);
    }
  }

  // Confirmed briefings omit memberName and memberBusiness while providing instructions & coordinator contact
  assert.ok(subSnap.confirmedBriefings!.length > 0);
  for (const b of subSnap.confirmedBriefings!) {
    assert.equal('memberName' in b, false);
    assert.equal('memberBusiness' in b, false);
    assert.equal('memberPhone' in b, false);
    assert.ok(b.coordinatorName.length > 0);
    assert.ok(b.coordinatorCallingPhone.length > 0);
  }

  // Substitute earnings sanitize memberName & memberId
  for (const earn of subSnap.myEarnings!) {
    assert.equal(earn.memberName, '');
    assert.equal(earn.memberId, '');
  }
});

test('P4-06: Pre-embedded WhatsApp chats stay concise and wrap dynamic fields with *...*; photo share contains ONLY chapter name and date', () => {
  const photoMsg = buildReachedPhotoWhatsAppText('BNI Elegance', '2026-11-23');
  assert.equal(photoMsg, '*BNI Elegance* · *Mon, 23 Nov*');
  assert.equal(photoMsg.includes('\n'), false);
  assert.equal(photoMsg.includes('Venue'), false);

  const coordUpdate = buildCoordinatorUpdateWhatsAppText('Kishan Mehta', 'BNI Elegance', '2026-11-23');
  assert.ok(coordUpdate.includes('*Kishan Mehta*'));
  assert.ok(coordUpdate.includes('*BNI Elegance*'));
  assert.ok(coordUpdate.includes('*Mon, 23 Nov*'));

  const helpMsg = buildOpenRequestHelpWhatsAppText('Priya Deshmukh', 'BNI Titans', '2026-11-23');
  assert.ok(helpMsg.includes('*Priya Deshmukh*'));
  assert.ok(helpMsg.includes('*BNI Titans*'));
  assert.ok(helpMsg.includes('*Mon, 23 Nov*'));

  const memberConf = buildMemberConfirmationWhatsAppText({
    chapterName: 'BNI Elegance',
    meetingDate: '2026-11-23',
    reportingTime: '07:15 AM',
    attendeeName: 'Surya Menon',
    coordinatorName: 'Kishan Mehta',
  });
  assert.ok(memberConf.includes('*BNI Elegance*'));
  assert.ok(memberConf.includes('*Mon, 23 Nov*'));
  assert.ok(memberConf.includes('*07:15 AM*'));
  assert.ok(memberConf.includes('*Surya Menon*'));
  assert.ok(memberConf.includes('*Kishan Mehta*'));

  const memCheck = buildMemberCheckinWhatsAppText('Amit Patel', 'BNI Elegance');
  assert.equal(memCheck, 'Hi *Amit Patel*, checking in for *BNI Elegance*.');

  const teamAvail = buildTeamAvailabilityWhatsAppText('Surya Menon');
  assert.equal(teamAvail, "Hi *Surya Menon*, are you available for tomorrow's meeting?");

  const memRem = buildMemberReminderWhatsAppText({
    memberName: 'Arjun Malhotra',
    items: [{ meetingDate: '2026-11-21', chapterName: 'BNI Elegance', dueAmount: 300 }],
    totalOutstanding: 300,
  });
  assert.ok(memRem.includes('*Arjun Malhotra*'));
  assert.ok(memRem.includes('*BNI Elegance*'));
  assert.ok(memRem.includes('*₹300*'));

  const payoutMsg = buildPayoutSummaryWhatsAppText({
    substituteName: 'Surya Menon',
    items: [{ meetingDate: '2026-11-21', chapterName: 'BNI Elegance', amount: 350 }],
    bonusesTotal: 100,
    outstanding: 350,
  });
  assert.ok(payoutMsg.includes('*Surya Menon*'));
  assert.ok(payoutMsg.includes('*BNI Elegance*'));
  assert.ok(payoutMsg.includes('*₹100*'));
  assert.ok(payoutMsg.includes('*₹350*'));
});

test('P4-07: Clickable notification resolver routes Admin, Coordinator, and Veloctive Team directly to exact destination & record', () => {
  const ctx = {
    requests: [{ id: 'req-tmrw-3' }, { id: 'req-tmrw-6' }, { id: 'req-prev-4' }],
    assignments: [{ id: 'asgn-prev-4', requestId: 'req-prev-4' }, { id: 'asgn-tmrw-1', requestId: 'req-tmrw-3' }],
    openRequests: [{ id: 'req-tmrw-4' }],
  };

  // Admin clicking a request notification lands on Requests with that exact requestId
  const adminReq = resolveNotificationDestination(
    { category: 'REQUEST', title: '3 Candidates Responded', body: 'BNI Elegance #103', relatedId: 'req-tmrw-3' },
    'SUPER_ADMIN',
    ctx
  );
  assert.equal(adminReq.tab, 'requests');
  assert.equal(adminReq.requestId, 'req-tmrw-3');

  // Admin clicking a dispute/check-in notification referencing an assignment ID resolves to its parent requestId
  const adminDispute = resolveNotificationDestination(
    { category: 'DISPUTE', title: 'Early Finish Under Review', body: 'Request #98', relatedId: 'asgn-prev-4' },
    'SUPER_ADMIN',
    ctx
  );
  assert.equal(adminDispute.tab, 'requests');
  assert.equal(adminDispute.requestId, 'req-prev-4');

  // Coordinator clicking a check-in notification resolves assignment -> requestId
  const ecCheckin = resolveNotificationDestination(
    { category: 'CHECKIN', title: 'Reached Venue', body: 'BNI Elegance', relatedId: 'asgn-tmrw-1' },
    'EXTERNAL_COORDINATOR',
    ctx
  );
  assert.equal(ecCheckin.tab, 'requests');
  assert.equal(ecCheckin.requestId, 'req-tmrw-3');

  // Admin clicking Finance payout vs receipt notification
  const adminPayout = resolveNotificationDestination(
    { category: 'FINANCE', title: 'Payout Recorded', body: 'Paid ₹350' },
    'SUPER_ADMIN',
    ctx
  );
  assert.equal(adminPayout.tab, 'finance');
  assert.equal(adminPayout.financeTab, 'payments');

  // Veloctive Team clicking Open Request notification lands on Open Requests focused on that card
  const subOpen = resolveNotificationDestination(
    { category: 'REQUEST', title: 'New First-Confirm Request Open', body: 'BNI Titans', relatedId: 'req-tmrw-4' },
    'SUBSTITUTE',
    ctx
  );
  assert.equal(subOpen.tab, 'open');
  assert.equal(subOpen.openRequestId, 'req-tmrw-4');

  // Veloctive Team clicking Appreciation Bonus / Finance notification lands on Earnings
  const subFinance = resolveNotificationDestination(
    { category: 'FINANCE', title: 'Appreciation Bonus Credited', body: '₹100 bonus', relatedId: 'pay-1' },
    'SUBSTITUTE',
    ctx
  );
  assert.equal(subFinance.tab, 'earnings');

  // Veloctive Team clicking Assignment notification lands on My Meetings focused on that assignment
  const subMeeting = resolveNotificationDestination(
    { category: 'ASSIGNMENT', title: 'Confirmed', body: 'BNI Elegance', relatedId: 'asgn-tmrw-1' },
    'SUBSTITUTE',
    ctx
  );
  assert.equal(subMeeting.tab, 'meetings');
  assert.equal(subMeeting.assignmentId, 'asgn-tmrw-1');
});

test('P4-08: Optional Member Note (General note / Referral round / Special instruction) attaches on request or post-confirm, stays hidden on Open Requests, notifies confirmed team member, and formats concisely on WA', () => {
  const store = new AgencyStore(() => SAT_21_NOV_2026_IST);
  const sa = store.loginDemo('SA');
  const surya = store.loginDemo('SUB');

  assert.equal(getMemberNoteTypeLabel('GENERAL_NOTE'), 'General note');
  assert.equal(getMemberNoteTypeLabel('REFERRAL_ROUND'), 'Referral round');
  assert.equal(getMemberNoteTypeLabel('SPECIAL_INSTRUCTION'), 'Special instruction');

  // 1. Create request with optional Referral round note attached
  const { request: reqWithAsk } = store.createRequest(sa, {
    goingForMemberId: 'mem-amit',
    meetingDate: '2026-11-29',
    assignmentMode: 'FIRST_CONFIRM',
    memberNoteType: 'REFERRAL_ROUND',
    referralAsk: 'Ask for warm intro to warehouse operators in Bhiwandi.',
  });
  assert.equal(reqWithAsk.memberNoteType, 'REFERRAL_ROUND');
  assert.equal(reqWithAsk.referralAskSnapshot, 'Ask for warm intro to warehouse operators in Bhiwandi.');

  // 2. Unconfirmed substitute viewing openRequests must NEVER see the note (privacy gate)
  const subBootBefore = store.getBootstrapPayload(surya) as unknown as {
    openRequests: Array<Record<string, unknown>>;
    confirmedBriefings: Array<{ assignment: { requestId: string; id: string }; memberNoteType?: string; referralAsk?: string }>;
  };
  const openCard = subBootBefore.openRequests.find((r) => r.id === reqWithAsk.id);
  assert.ok(openCard);
  assert.equal('referralAsk' in openCard!, false);
  assert.equal('memberNoteType' in openCard!, false);

  // 3. Once confirmed, confirmedBriefings delivers both memberNoteType and referralAsk
  const { assignment } = store.submitResponse(surya, reqWithAsk.id, { responseType: 'FIRST_CONFIRM' });
  assert.ok(assignment);
  const subBootConfirmed = store.getBootstrapPayload(surya) as unknown as {
    confirmedBriefings: Array<{ assignment: { requestId: string; id: string }; memberNoteType?: string; referralAsk?: string }>;
    notifications: Array<{ title: string; relatedId?: string }>;
  };
  const briefing = subBootConfirmed.confirmedBriefings.find((b) => b.assignment.requestId === reqWithAsk.id);
  assert.equal(briefing?.memberNoteType, 'REFERRAL_ROUND');
  assert.equal(briefing?.referralAsk, 'Ask for warm intro to warehouse operators in Bhiwandi.');

  // 4. Updating note post-confirmation to SPECIAL_INSTRUCTION updates briefing & notifies confirmed substitute
  store.updateRequestReferralAsk(
    sa,
    reqWithAsk.id,
    'Hand over the brown sample folder to the chapter president before open networking.',
    'SPECIAL_INSTRUCTION'
  );
  const subBootUpdated = store.getBootstrapPayload(surya) as unknown as {
    confirmedBriefings: Array<{ assignment: { requestId: string; id: string }; memberNoteType?: string; referralAsk?: string }>;
    notifications: Array<{ title: string; relatedId?: string }>;
  };
  const updatedBriefing = subBootUpdated.confirmedBriefings.find((b) => b.assignment.requestId === reqWithAsk.id);
  assert.equal(updatedBriefing?.memberNoteType, 'SPECIAL_INSTRUCTION');
  assert.equal(
    updatedBriefing?.referralAsk,
    'Hand over the brown sample folder to the chapter president before open networking.'
  );
  assert.ok(
    subBootUpdated.notifications.some(
      (n) => n.title.includes('Special instruction Updated') && n.relatedId === assignment!.id
    ),
    'Confirmed substitute must receive a clickable notification with the selected note type label'
  );

  // 5. WhatsApp share builder uses selected category label with *...* highlighting and zero member identity
  const waMsg = buildReferralAskWhatsAppText(
    'BNI Elegance',
    '2026-11-29',
    'Pass referral for Rahul Interiors',
    'REFERRAL_ROUND'
  );
  assert.ok(waMsg.includes('*BNI Elegance*'));
  assert.ok(waMsg.includes('*Sun, 29 Nov*'));
  assert.ok(waMsg.includes('Referral round: *Pass referral for Rahul Interiors*'));
  assert.equal(waMsg.includes('Amit'), false);
});
