<?php
/**
 * SK Blog — テーマの設定
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SK_BLOG_VERSION', '1.0.0' );

/** テーマカラー（SK のサイトの data-accent と同じ名前）。[ 名前 => 表示名 ] */
function sk_blog_accents() {
	return array(
		'blue'   => "SK's Blue",
		'sakura' => "SK's Sakura",
		'matcha' => "SK's Matcha",
		'mikan'  => "SK's Mikan",
		'fuji'   => "SK's Fuji",
		'sora'   => "SK's Sora",
		'sumi'   => "SK's Sumi",
	);
}

function sk_blog_setup() {
	load_theme_textdomain( 'sk-blog', get_template_directory() . '/languages' );

	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'wp-block-styles' );
	add_theme_support( 'align-wide' );
	add_theme_support( 'custom-logo', array( 'height' => 52, 'width' => 52, 'flex-height' => true, 'flex-width' => true ) );

	add_image_size( 'sk-card', 960, 540, true );

	register_nav_menus(
		array(
			'primary' => 'ヘッダーのメニュー',
			'footer'  => 'フッターのリンク',
		)
	);
}
add_action( 'after_setup_theme', 'sk_blog_setup' );

function sk_blog_assets() {
	wp_enqueue_style(
		'sk-blog-fonts',
		'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+JP:wght@400;500;700;800&display=swap',
		array(),
		null
	);
	wp_enqueue_style( 'sk-blog', get_template_directory_uri() . '/assets/css/main.css', array( 'sk-blog-fonts' ), SK_BLOG_VERSION );
	wp_enqueue_script( 'sk-blog', get_template_directory_uri() . '/assets/js/main.js', array(), SK_BLOG_VERSION, array( 'in_footer' => true, 'strategy' => 'defer' ) );

	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) {
		wp_enqueue_script( 'comment-reply' );
	}
}
add_action( 'wp_enqueue_scripts', 'sk_blog_assets' );

/** ちらつかないよう、表示（ライト・ダーク）を CSS より先に <html> に付ける。SK のサイトと同じ localStorage の "sk_theme" を見る */
function sk_blog_theme_boot() {
	$accent = get_theme_mod( 'sk_blog_accent', 'blue' );
	if ( ! isset( sk_blog_accents()[ $accent ] ) ) {
		$accent = 'blue';
	}
	?>
<script>(function(){try{var d=document.documentElement,t=JSON.parse(localStorage.getItem("sk_theme")||"{}");if(t.mode==="light"||t.mode==="dark")d.setAttribute("data-theme",t.mode);var a=<?php echo wp_json_encode( $accent ); ?>;if(a!=="blue")d.setAttribute("data-accent",a);}catch(e){}})();</script>
	<?php
}
add_action( 'wp_head', 'sk_blog_theme_boot', 1 );

/** カスタマイザー: テーマカラー・フッターの文 */
function sk_blog_customize( $wp_customize ) {
	$wp_customize->add_section(
		'sk_blog',
		array(
			'title'    => 'SK Blog',
			'priority' => 30,
		)
	);

	$wp_customize->add_setting(
		'sk_blog_accent',
		array(
			'default'           => 'blue',
			'sanitize_callback' => function ( $v ) {
				return isset( sk_blog_accents()[ $v ] ) ? $v : 'blue';
			},
		)
	);
	$wp_customize->add_control(
		'sk_blog_accent',
		array(
			'label'   => 'テーマカラー',
			'section' => 'sk_blog',
			'type'    => 'select',
			'choices' => sk_blog_accents(),
		)
	);

	$wp_customize->add_setting( 'sk_blog_kicker', array( 'default' => 'SK Blog', 'sanitize_callback' => 'sanitize_text_field' ) );
	$wp_customize->add_control( 'sk_blog_kicker', array( 'label' => 'トップの小見出し', 'section' => 'sk_blog', 'type' => 'text' ) );

	$wp_customize->add_setting( 'sk_blog_lead', array( 'default' => '', 'sanitize_callback' => 'sanitize_text_field' ) );
	$wp_customize->add_control( 'sk_blog_lead', array( 'label' => 'トップの説明文（空ならサイトのキャッチフレーズ）', 'section' => 'sk_blog', 'type' => 'textarea' ) );

	$wp_customize->add_setting( 'sk_blog_footer_text', array( 'default' => '', 'sanitize_callback' => 'sanitize_text_field' ) );
	$wp_customize->add_control( 'sk_blog_footer_text', array( 'label' => 'フッターの説明文', 'section' => 'sk_blog', 'type' => 'text' ) );
}
add_action( 'customize_register', 'sk_blog_customize' );

/** 一覧の抜粋 */
function sk_blog_excerpt_length() {
	return 60;
}
add_filter( 'excerpt_length', 'sk_blog_excerpt_length' );
add_filter( 'excerpt_more', '__return_empty_string' );

/** メニューのリンクに .hd-item を付ける（ヘッダーの共通の見た目） */
function sk_blog_menu_link_attrs( $atts, $item, $args ) {
	if ( isset( $args->theme_location ) && 'primary' === $args->theme_location ) {
		$atts['class'] = trim( ( $atts['class'] ?? '' ) . ' hd-item' );
	}
	return $atts;
}
add_filter( 'nav_menu_link_attributes', 'sk_blog_menu_link_attrs', 10, 3 );

/** メニューが未設定のときの代わり */
function sk_blog_fallback_menu() {
	echo '<ul class="hd-nav">';
	echo '<li><a class="hd-item" href="' . esc_url( home_url( '/' ) ) . '">ホーム</a></li>';
	foreach ( get_categories( array( 'number' => 4, 'orderby' => 'count', 'order' => 'DESC' ) ) as $cat ) {
		echo '<li><a class="hd-item" href="' . esc_url( get_category_link( $cat ) ) . '">' . esc_html( $cat->name ) . '</a></li>';
	}
	echo '<li><a class="hd-item" href="https://sk-hub.jp/" rel="noopener">SK のサイト</a></li>';
	echo '</ul>';
}

/** 投稿の読了時間の目安（日本語は 1 分 500 文字） */
function sk_blog_reading_minutes( $post = null ) {
	$text = wp_strip_all_tags( get_post_field( 'post_content', $post ) );
	$len  = function_exists( 'mb_strlen' ) ? mb_strlen( $text ) : strlen( $text );
	return max( 1, (int) ceil( $len / 500 ) );
}

/** 先頭のカテゴリ（色のドットとラベルに使う） */
function sk_blog_primary_category( $post_id = null ) {
	$cats = get_the_category( $post_id );
	return $cats ? $cats[0] : null;
}

/** カテゴリーのラベル */
function sk_blog_cat_chip( $cat ) {
	if ( ! $cat ) {
		return;
	}
	printf(
		'<span class="chip"><span class="chip-dot"></span>%s</span>',
		esc_html( $cat->name )
	);
}
