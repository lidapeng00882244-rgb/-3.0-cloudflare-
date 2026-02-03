/**
 * Cloudflare Pages Function: GET /health
 */
export async function onRequestGet() {
    return Response.json({
        success: true,
        message: '服务运行正常',
        platform: 'Cloudflare Pages'
    }, {
        headers: { 'Access-Control-Allow-Origin': '*' }
    });
}
