/**
 * Instagram Graph API integration via Facebook Pages
 * Fetches all comments from an Instagram post using pagination
 */

import { type Participant, processParticipants, type Comment } from './apify';

const GRAPH_API_VERSION = 'v21.0';

interface GraphComment {
    id: string;
    text: string;
    username: string;
    timestamp: string;
    like_count?: number;
}

interface GraphResponse<T> {
    data: T[];
    paging?: {
        cursors?: { before: string; after: string };
        next?: string;
    };
}

interface PageAccount {
    id: string;
    instagram_business_account?: { id: string };
}

interface IGMedia {
    id: string;
    shortcode?: string;
}

/**
 * Fetch all comments from an Instagram post via the Graph API.
 * Handles pagination automatically (50 per page).
 */
export async function fetchInstagramGraphComments(
    postUrl: string,
    accessToken: string,
    onProgress?: (loaded: number) => void
): Promise<Participant[]> {
    // 1. Extract shortcode from URL
    const shortcode = extractShortcode(postUrl);
    if (!shortcode) {
        throw new Error('URL no válida. Usa el formato: https://www.instagram.com/p/XXXXX/');
    }

    // 2. Get Instagram Business Account ID
    const igUserId = await getIGUserId(accessToken);

    // 3. Find the media ID from shortcode
    const mediaId = await findMediaByShortcode(igUserId, shortcode, accessToken);

    // 4. Fetch ALL comments with pagination
    const allComments = await fetchAllComments(mediaId, accessToken, onProgress);

    // 5. Convert to our Comment format and process
    const comments: Comment[] = allComments.map(c => ({
        id: c.id,
        text: c.text,
        ownerUsername: c.username,
        ownerProfilePicUrl: '',
        timestamp: c.timestamp,
        likesCount: c.like_count || 0,
        repliesCount: 0,
    }));

    return processParticipants(comments);
}

/**
 * Extract shortcode from Instagram URL.
 * Supports: /p/XXX/, /reel/XXX/, /tv/XXX/
 */
function extractShortcode(url: string): string | null {
    const patterns = [
        /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
        /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
        /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

/**
 * Get the Instagram Business/Creator Account ID linked to the user's Facebook Page.
 */
async function getIGUserId(accessToken: string): Promise<string> {
    const res = await graphFetch<GraphResponse<PageAccount>>(
        `/me/accounts?fields=instagram_business_account&limit=100`,
        accessToken
    );

    for (const page of res.data) {
        if (page.instagram_business_account?.id) {
            return page.instagram_business_account.id;
        }
    }

    throw new Error(
        'No se encontró una cuenta de Instagram vinculada. ' +
        'Asegúrate de que tu cuenta Creator/Business esté conectada a una Facebook Page.'
    );
}

/**
 * Find the IG Media ID by shortcode.
 * Paginates through recent media to find the matching post.
 */
async function findMediaByShortcode(
    igUserId: string,
    shortcode: string,
    accessToken: string
): Promise<string> {
    let url = `/${igUserId}/media?fields=id,shortcode&limit=50`;

    // Paginate through media to find the shortcode
    for (let page = 0; page < 20; page++) {
        const res = await graphFetch<GraphResponse<IGMedia>>(url, accessToken);

        for (const media of res.data) {
            if (media.shortcode === shortcode) {
                return media.id;
            }
        }

        if (!res.paging?.next) break;

        // Extract the relative URL from the next link
        const nextUrl = new URL(res.paging.next);
        url = nextUrl.pathname.replace(`/${GRAPH_API_VERSION}`, '') + nextUrl.search;
    }

    throw new Error(
        `No se encontró el post con shortcode "${shortcode}". ` +
        'Verifica que el post pertenece a tu cuenta de Instagram vinculada.'
    );
}

/**
 * Fetch ALL comments from a media object, following pagination.
 */
async function fetchAllComments(
    mediaId: string,
    accessToken: string,
    onProgress?: (loaded: number) => void
): Promise<GraphComment[]> {
    const allComments: GraphComment[] = [];
    let url = `/${mediaId}/comments?fields=id,text,username,timestamp,like_count&limit=50`;

    for (let page = 0; page < 100; page++) {
        const res = await graphFetch<GraphResponse<GraphComment>>(url, accessToken);

        allComments.push(...res.data);
        onProgress?.(allComments.length);

        if (!res.paging?.next) break;

        // Extract relative path for the next page
        const nextUrl = new URL(res.paging.next);
        url = nextUrl.pathname.replace(`/${GRAPH_API_VERSION}`, '') + nextUrl.search;
    }

    return allComments;
}

/**
 * Make a Graph API request through the Vite proxy.
 */
async function graphFetch<T>(endpoint: string, accessToken: string): Promise<T> {
    // Remove leading slash if present
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    // Add access_token if not already in the URL
    const separator = path.includes('?') ? '&' : '?';
    const urlWithToken = path.includes('access_token')
        ? path
        : `${path}${separator}access_token=${accessToken}`;

    const res = await fetch(`/graph-api/${GRAPH_API_VERSION}${urlWithToken}`);

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData?.error?.message || `Error HTTP ${res.status}`;
        throw new Error(`Error de Graph API: ${msg}`);
    }

    return res.json();
}
