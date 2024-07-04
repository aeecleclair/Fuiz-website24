import { WALLO_CLIENT_SECRET } from '$env/static/private';
import { fail, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { IdlessSlide, Media, OnlineFuiz } from '$lib/types';
import { isNotUndefined } from '$lib/util';
import { parse } from '@ltd/j-toml';
import { updateFileInGit } from '$lib/gitlab';
import { getThumbnail } from '$lib/serverOnlyUtils';

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	const encoder = new TextEncoder();

	const aEncoded = encoder.encode(a);
	const bEncoded = encoder.encode(b);

	if (aEncoded.byteLength !== bEncoded.byteLength) return false;

	return crypto.subtle.timingSafeEqual(aEncoded, bEncoded);
}

type Response = {
	medias: WalloMedia[];
	possibleActions: PossibleAction[];
};

type PossibleAction = {
	id: string;
	display?: string;
	variant?: 'default' | 'secondary' | 'destructive' | 'outline';
};

type WalloMedia =
	| {
			kind: 'text';
			message: string;
			tag?: string;
	  }
	| {
			kind: 'image';
			url: string;
			alt?: string;
			tag?: string;
	  }
	| {
			kind: 'video';
			url: string;
			tag?: string;
	  };

export const POST: RequestHandler = async ({ request, platform }) => {
	const auth = request.headers.get('Authorization')?.trim();
	if (!timingSafeEqual(auth ?? '', `Basic ${WALLO_CLIENT_SECRET}`)) throw fail(403);

	const body = (await request.json()) as {
		kind: 'content';
		relevantId: string;
		action?: string;
	};

	console.log(body);

	if (body.action) {
		console.log(`Received action ${body.action} for ${body.relevantId}`);

		const { relevantId } = body;

		const pendingSubmission = await platform?.env.DATABASE.prepare(
			`SELECT * FROM pending_submissions WHERE storage_id = ?`
		)
			.bind(relevantId)
			.first();

		if (pendingSubmission) {
			const desiredId =
				(await platform?.env.DATABASE.prepare(
					`DELETE FROM pending_submissions WHERE storage_id = ? RETURNING desired_id`
				)
					.bind(relevantId)
					.first<string>('desired_id')) ?? null;

			if (!desiredId) throw fail(404);

			if (body.action === 'approve') {
				const fuizText = await (await platform?.env.BUCKET.get(relevantId))?.text();

				if (!fuizText) throw fail(404);

				let played_count = 0;

				if (desiredId !== relevantId) {
					await platform?.env.BUCKET.delete(desiredId);
					await platform?.env.BUCKET.put(desiredId, fuizText);
					await platform?.env.BUCKET.delete(relevantId);
					played_count =
						(await platform?.env.DATABASE.prepare(
							`DELETE FROM approved_submissions WHERE storage_id = ? RETURNING played_count`
						)
							.bind(desiredId)
							.first<number>('played_count')) ?? 0;
				}

				const gitUrl = ''; //await updateFileInGit(desiredId + '.toml', fuizText);

				const {
					author,
					subjects = [],
					grades = [],
					language,
					config: { title, slides }
				} = parse(fuizText, {
					bigint: false
				}) as OnlineFuiz;

				const { thumbnail, thumbnailAlt } = (await getThumbnail({ title, slides })) || {
					thumbnail: null,
					thumbnailAlt: null
				};

				await platform?.env.DATABASE.prepare(
					`INSERT INTO approved_submissions (
						storage_id,
						title,
						author,
						public_url,
						subjects,
						grades,
						slides_count,
						played_count,
						language_code,
						thumbnail_alt,
						thumbnail
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
					.bind(
						desiredId,
						title,
						author,
						gitUrl,
						subjects.join(' ~ '),
						grades.join(' ~ '),
						slides.length,
						played_count,
						language,
						thumbnailAlt,
						thumbnail
					)
					.run();
			} else if (body.action === 'reject') {
				await platform?.env.DATABASE.prepare(
					`INSERT INTO denied_submissions (storage_id, desired_id) VALUES (?1, ?2)`
				)
					.bind(relevantId, desiredId)
					.run();
			} else {
				throw fail(400);
			}

			return json({ success: true });
		}

		const approvedSubmission = await platform?.env.DATABASE.prepare(
			`SELECT * FROM approved_submissions WHERE storage_id = ?`
		)
			.bind(relevantId)
			.first();

		if (approvedSubmission) {
			if (body.action === 'unapprove') {
				await platform?.env.DATABASE.prepare(
					`DELETE FROM approved_submissions WHERE storage_id = ?`
				)
					.bind(relevantId)
					.run();

				await platform?.env.DATABASE.prepare(
					`INSERT INTO denied_submissions (storage_id, desired_id) VALUES (?1, ?1)`
				)
					.bind(relevantId)
					.run();

				return json({ success: true });
			} else {
				throw fail(400);
			}
		}

		const deniedSubmission = await platform?.env.DATABASE.prepare(
			`SELECT * FROM denied_submissions WHERE storage_id = ?`
		)
			.bind(relevantId)
			.first();

		if (deniedSubmission) {
			if (body.action === 'reapprove') {
				const desiredId = await platform?.env.DATABASE.prepare(
					`DELETE FROM denied_submissions WHERE storage_id = ? RETURNING desired_id`
				)
					.bind(relevantId)
					.first<string>('desired_id');

				if (!desiredId) throw fail(404);

				const fuizText = await (await platform?.env.BUCKET.get(relevantId))?.text();

				if (!fuizText) throw fail(404);

				let played_count = 0;

				if (desiredId !== relevantId) {
					await platform?.env.BUCKET.delete(desiredId);
					await platform?.env.BUCKET.put(desiredId, fuizText);
					await platform?.env.BUCKET.delete(relevantId);
					played_count =
						(await platform?.env.DATABASE.prepare(
							`DELETE FROM approved_submissions WHERE storage_id = ? RETURNING played_count`
						)
							.bind(desiredId)
							.first<number>('played_count')) ?? 0;
				}

				const gitUrl = ''; //await updateFileInGit(desiredId + '.toml', fuizText);

				const {
					author,
					subjects = [],
					grades = [],
					language,
					config: { title, slides }
				} = parse(fuizText, {
					bigint: false
				}) as OnlineFuiz;

				const { thumbnail, thumbnailAlt } = (await getThumbnail({ title, slides })) || {
					thumbnail: null,
					thumbnailAlt: null
				};

				await platform?.env.DATABASE.prepare(
					`INSERT INTO approved_submissions (
							storage_id,
							title,
							author,
							public_url,
							subjects,
							grades,
							slides_count,
							played_count,
							language_code,
							thumbnail_alt,
							thumbnail
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
					.bind(
						desiredId,
						title,
						author,
						gitUrl,
						subjects.join(' ~ '),
						grades.join(' ~ '),
						slides.length,
						played_count,
						language,
						thumbnailAlt,
						thumbnail
					)
					.run();
				return json({ success: true });
			} else {
				throw fail(400);
			}
		}
	} else {
		const { relevantId } = body;

		const fuiz_str = await (await platform?.env.BUCKET.get(relevantId))?.text();

		if (!fuiz_str) throw fail(404);

		const fuiz = parse(fuiz_str, { bigint: false }) as OnlineFuiz;

		function serializeMedia(media: Media | undefined): WalloMedia | undefined {
			if (!media) return undefined;
			if (!('Base64' in media.Image)) return undefined;
			return {
				kind: 'image',
				url: media.Image.Base64.data,
				alt: media.Image.Base64.alt,
				tag: 'Slide Image'
			};
		}

		const originalMedias: WalloMedia[] = [
			{
				kind: 'text',
				message: fuiz.author,
				tag: 'Author'
			},
			{
				kind: 'text',
				message: fuiz.language,
				tag: 'Language'
			},
			{
				kind: 'text',
				message: fuiz.subjects?.join(', ') ?? '',
				tag: 'Subjects'
			},
			{
				kind: 'text',
				message: fuiz.grades?.join(', ') ?? '',
				tag: 'Grades'
			},
			{
				kind: 'text',
				message: fuiz.config.title,
				tag: 'Title'
			}
		];

		function extractSlide(slide: IdlessSlide): WalloMedia[] {
			const medias: (WalloMedia | undefined)[] = [
				{
					kind: 'text',
					message: slide.MultipleChoice.title,
					tag: 'Slide Title'
				},
				{
					kind: 'text',
					message: slide.MultipleChoice.answers
						.map((a) => `- ${a.content.Text}, ${a.correct ? 'correct' : 'wrong'}`)
						.join('\n'),
					tag: 'Slide Answers'
				},
				{
					kind: 'text',
					message: slide.MultipleChoice.introduce_question.toString() + 'ms',
					tag: 'Introduce Question'
				},
				{
					kind: 'text',
					message: slide.MultipleChoice.time_limit.toString() + 'ms',
					tag: 'Time Limit'
				},
				{
					kind: 'text',
					message: slide.MultipleChoice.points_awarded.toString() + 'pts',
					tag: 'Points Awarded'
				},
				serializeMedia(slide.MultipleChoice.media)
			];

			return medias.filter(isNotUndefined);
		}

		const medias: WalloMedia[] = originalMedias.concat(fuiz.config.slides.flatMap(extractSlide));

		const pendingSubmission = await platform?.env.DATABASE.prepare(
			`SELECT * FROM pending_submissions WHERE storage_id = ?`
		)
			.bind(relevantId)
			.first();

		if (pendingSubmission) {
			const response: Response = {
				possibleActions: [
					{
						id: 'approve',
						display: 'Approve'
					},
					{
						id: 'reject',
						display: 'Reject',
						variant: 'destructive'
					}
				],
				medias
			};

			return json(response);
		}

		const approvedSubmission = await platform?.env.DATABASE.prepare(
			`SELECT * FROM approved_submissions WHERE storage_id = ?`
		)
			.bind(relevantId)
			.first();

		if (approvedSubmission) {
			const response: Response = {
				possibleActions: [
					{
						id: 'unapprove',
						display: 'Unapprove',
						variant: 'destructive'
					}
				],
				medias
			};

			return json(response);
		}

		const deniedSubmission = await platform?.env.DATABASE.prepare(
			`SELECT * FROM denied_submissions WHERE storage_id = ?`
		)
			.bind(relevantId)
			.first();

		if (deniedSubmission) {
			const response: Response = {
				possibleActions: [
					{
						id: 'reapprove',
						display: 'Reapprove'
					}
				],
				medias
			};

			return json(response);
		}

		throw fail(404);
	}

	return new Response();
};
