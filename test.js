const doc = {
  rule_engine: {
    rule_engine_type: 1,
    target_onload_select_query: "body",
    interaction_time: 5000,
    scroll_target_select_query: ".section_two",
    scroll_target_config: { threshold: 0.8, rootMargin: "0px" },
    match_urls: ["http://127.0.0.1:5500/test/index.html"],
    session: true,
  },
  notification: {
    notification_type: 1,
    category: 3,
    title: {
      visibility: true,
      text: "Exciting News: Introducing Our New Video SEO Feature!",
    },
    description: {
      visibility: true,
      text:
        "We're thrilled to announce the launch of our latest feature designed to take your video content to new heights - Video SEO! 🚀",
    },
    image: {
      src:
        "https://delivery.animaker.com/p/u/klblx84847/osrc/images/2024/04/43339trUV34BTkDQXv1ow.png",
      href: "https://www.getshow.io/",
    },
    video: {
      script: `
            <div class="animaker_responsive_padding" style="padding:56.25% 0 0 0;position:relative;">
                <div class="animaker_responsive_wrapper" style="height:100%;left:0;position:absolute;top:0;width:100%;">
                    <iframe src="https://app.getshow.io/iframe/media/HlGQsosBzfN2mLB6LjOj" width="100%" height="100%" title="Show.mp4" allow="autoplay; fullscreen" allowtransparency="true" frameborder="0" scrolling="no" class="animaker_player" name="animaker_player" allowfullscreen msallowfullscreen webkitallowfullscreen mozallowfullscreen style="width: 100%; height: 100%;"></iframe>
                </div>
            </div>
        `,
    },
    cta: {
      label: "Click Here!",
      href: "https://www.getshow.io/",
    },
  },
  rule_queryset: '{"search__&":[{"search__&":[{"search_item":"Oregon","search_key":"meta_info.region","search_option":"3","search_meta_info":{"name":"Is","id":"is","inputType":"text","default":"","value":"","displayName":""}}]}]}',
};
