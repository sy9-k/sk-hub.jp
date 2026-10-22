<?php
/**
 * ヘッダー（SK のサイトと同じ、上に固定したすりガラスのバー。スマホは「ロゴ＋メニューのボタン」）
 */
$logo_url = get_template_directory_uri() . '/assets/img/logo.svg';
$menu_args = array(
	'theme_location' => 'primary',
	'container'      => false,
	'fallback_cb'    => 'sk_blog_fallback_menu',
	'depth'          => 1,
);
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="theme-color" content="#ffffff" data-theme-color>
	<link rel="icon" href="<?php echo esc_url( get_template_directory_uri() . '/assets/img/favicon.svg' ); ?>" type="image/svg+xml">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'sk-blog' ); ?>>
<?php wp_body_open(); ?>
<a class="skip" href="#main">本文へ移動</a>

<header class="site-header">
	<a class="hd-logo" href="<?php echo esc_url( home_url( '/' ) ); ?>" aria-label="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?> ホーム">
		<span class="hd-logo-image" aria-hidden="true">
			<?php if ( has_custom_logo() ) : ?>
				<?php echo wp_get_attachment_image( get_theme_mod( 'custom_logo' ), array( 26, 26 ), false, array( 'alt' => '' ) ); ?>
			<?php else : ?>
				<img src="<?php echo esc_url( $logo_url ); ?>" alt="" width="26" height="26">
			<?php endif; ?>
		</span>
		<span class="hd-logo-back" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5M5 12L11 6M5 12L11 18" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
	</a>

	<nav class="hd-nav-wrap" aria-label="メインメニュー">
		<?php wp_nav_menu( $menu_args + array( 'menu_class' => 'hd-nav' ) ); ?>
	</nav>

	<a class="hd-item hd-search" href="<?php echo esc_url( home_url( '/?s=' ) ); ?>" aria-label="検索">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
	</a>
	<button class="hd-item hd-mode" type="button" data-mode-toggle aria-label="ライト・ダークを切り替える">
		<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
		<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
	</button>
	<button class="hd-menu-btn" type="button" aria-expanded="false" aria-controls="hd-menu" aria-label="メニュー"><span></span><span></span></button>
</header>

<div class="hd-menu" id="hd-menu">
	<div class="hd-menu-inner">
		<p class="hd-menu-title"><?php bloginfo( 'name' ); ?></p>
		<?php wp_nav_menu( $menu_args + array( 'menu_class' => 'hd-menu-list', 'link_class' => '' ) ); ?>
		<form class="hd-menu-search" role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>">
			<input type="search" name="s" placeholder="記事を検索" aria-label="記事を検索" value="<?php echo esc_attr( get_search_query() ); ?>">
		</form>
	</div>
</div>
<div class="hd-backdrop" id="hd-backdrop"></div>
